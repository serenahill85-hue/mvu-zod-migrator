import { parse } from './vendor/acorn.mjs';

// Only AST nodes in this module's allowlist are interpreted. No card code is run.
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LIMITS = { scripts: 32, source: 1500000, total: 4000000, nodes: 200000, depth: 80, fields: 12000 };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keyOf = n => n?.type === 'Identifier' ? n.name : n?.type === 'Literal' && ['string', 'number'].includes(typeof n.value) ? String(n.value) : null;
const memberName = n => n?.type === 'MemberExpression' && !n.computed ? keyOf(n.property) : n?.type === 'MemberExpression' && n.property.type === 'Literal' ? String(n.property.value) : null;
const methodName = n => n?.type === 'Identifier' ? n.name : memberName(n);
const unique = xs => [...new Set(xs)];
const unknown = reason => ({ kind: 'unknown', reason });

function jsonCopy(value, depth = 0, seen = new Set()) {
  if (depth > LIMITS.depth) throw new Error('变量嵌套超过检查上限');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)) throw new Error('变量必须是无循环的纯 JSON 数据');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new Error('变量对象不是纯 JSON 对象');
  seen.add(value);
  const out = Array.isArray(value) ? [] : {};
  for (const k of Object.keys(value)) {
    if (BAD_KEYS.has(k)) throw new Error(`不允许的变量键：${k}`);
    const property = Object.getOwnPropertyDescriptor(value, k);
    if (!property || !own(property, 'value')) throw new Error('变量不允许 getter/setter');
    out[k] = jsonCopy(property.value, depth + 1, seen);
  }
  seen.delete(value);
  return out;
}

export function discoverScripts(trees) {
  const found = [], seen = new Set();
  let scanned = 0;
  const visit = (node, inheritedEnabled = true, depth = 0) => {
    if (!node || typeof node !== 'object' || seen.has(node) || depth > 60 || ++scanned > 10000) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(v => visit(v, inheritedEnabled, depth + 1));
    const enabled = inheritedEnabled && node.enabled !== false;
    const value = isObject(node.value) ? node.value : node;
    if (typeof value.content === 'string') {
      const content = value.content;
      let score = 0;
      if (/\bregisterMvuSchema\b/.test(content)) score += 80;
      if (/\b(?:z|zod)\s*\.\s*(?:object|strictObject|looseObject)\s*\(/.test(content)) score += 40;
      if (/\b(?:z|zod)\s*\.\s*(?:record|array|enum|string|number)\s*\(/.test(content)) score += 10;
      if (/\bSchema\s*=/.test(content)) score += 10;
      if (/mvu|zod|变量结构/i.test(String(value.name || node.name || ''))) score += 5;
      if (score) found.push({ id: String(value.id || node.id || `script-${found.length + 1}`), name: String(value.name || node.name || '未命名脚本'), content, enabled: enabled && value.enabled !== false, score });
    }
    for (const k of ['children', 'scripts', 'value', 'script', 'folders']) if (node[k] && node[k] !== node) visit(node[k], enabled, depth + 1);
  };
  visit(trees);
  const keys = new Set();
  return found.filter(s => { const k = `${s.id}\0${s.content}`; if (keys.has(k)) return false; keys.add(k); return true; }).sort((a, b) => b.score - a.score);
}

function createReader(source) {
  const warnings = [], imports = [], roots = [], candidates = [], calls = [], mutations = [], usedBindings = new Set(), nodeScopes = new WeakMap();
  const global = { parent: null, bindings: new Map() };
  let nodes = 0;
  const warn = msg => warnings.push(`${source.name || source.id || '结构脚本'}：${msg}`);
  const ast = parse(source.content, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  const bind = (scope, name, item) => {
    if (scope.bindings.has(name)) scope.bindings.set(name, { ambiguous: true });
    else scope.bindings.set(name, item);
  };
  const patternNames = n => {
    if (!n) return [];
    if (n.type === 'Identifier') return [n.name];
    if (n.type === 'AssignmentPattern') return patternNames(n.left);
    if (n.type === 'RestElement') return patternNames(n.argument);
    if (n.type === 'ArrayPattern') return n.elements.flatMap(patternNames);
    if (n.type === 'ObjectPattern') return n.properties.flatMap(p => patternNames(p.type === 'RestElement' ? p.argument : p.value));
    return [];
  };
  function traverse(n, scope, depth = 0) {
    if (!n || typeof n.type !== 'string') return;
    walkNode(n, scope, depth);
  }
  const walkNode = (n, incoming, depth) => {
    if (++nodes > LIMITS.nodes || depth > 500) throw new Error('源码 AST 超过检查上限');
    if (['FunctionDeclaration', 'ClassDeclaration'].includes(n.type) && n.id) bind(incoming, n.id.name, { dynamic: true });
    let scope = incoming;
    if (n.type === 'Program' || n.type === 'BlockStatement' || /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type)) scope = { parent: incoming, bindings: new Map() };
    nodeScopes.set(n, scope);
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) {
      if (d.id.type === 'Identifier') {
        bind(scope, d.id.name, { node: d.init, scope, mutable: n.kind !== 'const' });
        if (/^(?:Schema|schema|MvuSchema|MVUSchema|StatDataSchema|VariableSchema)$/i.test(d.id.name)) candidates.push({ node: d.init, scope, label: d.id.name });
      } else for (const name of patternNames(d.id)) bind(scope, name, { dynamic: true });
    }
    if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type)) for (const name of n.params.flatMap(patternNames)) bind(scope, name, { parameter: true });
    if (n.type === 'ImportDeclaration') {
      imports.push({ sourceId: source.id || '', sourceName: source.name || '', kind: 'static', specifier: String(n.source.value), dynamic: false });
      for (const s of n.specifiers) bind(scope, s.local.name, { imported: true, from: String(n.source.value), importedName: s.imported?.name || (s.type === 'ImportNamespaceSpecifier' ? '*' : 'default') });
    }
    if (n.type === 'ImportExpression') imports.push({ sourceId: source.id || '', sourceName: source.name || '', kind: 'dynamic', specifier: n.source.type === 'Literal' ? String(n.source.value) : source.content.slice(n.source.start, n.source.end).slice(0, 300), dynamic: n.source.type !== 'Literal' });
    if (n.type === 'CallExpression' && methodName(n.callee) === 'registerMvuSchema') roots.push({ node: n.arguments[0], scope, label: 'registerMvuSchema' });
    if (n.type === 'CallExpression') calls.push({ node: n, scope });
    if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') mutations.push({ node: n.left || n.argument, scope });
    if (n.type === 'ExportDefaultDeclaration') candidates.push({ node: n.declaration, scope, label: 'default' });
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) { for (const child of value) if (child?.type) traverse(child, scope, depth + 1); }
      else if (value?.type) traverse(value, scope, depth + 1);
    }
  };
  traverse(ast, global);
  const findBinding = (name, scope) => { for (let s = scope; s; s = s.parent) if (s.bindings.has(name)) return s.bindings.get(name); return null; };
  // Detect renamed imports of registerMvuSchema after all scopes are populated.
  const findRegistrations = n => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name !== 'registerMvuSchema') {
      const binding = findBinding(n.callee.name, nodeScopes.get(n));
      if (binding?.importedName === 'registerMvuSchema') roots.push({ node: n.arguments[0], scope: nodeScopes.get(n), label: n.callee.name });
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) { for (const child of v) if (child?.type) findRegistrations(child); }
      else if (v?.type) findRegistrations(v);
    }
  };
  findRegistrations(ast);
  function literal(n, scope, stack = new Set(), depth = 0) {
    if (!n || depth > LIMITS.depth) throw new Error('缺少静态值或引用过深');
    if (n.type === 'Literal' && !n.regex && (n.value === null || ['string', 'boolean', 'number'].includes(typeof n.value))) return jsonCopy(n.value);
    if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
    if (n.type === 'Identifier') {
      const b = findBinding(n.name, scope);
      if (!b?.node || b.mutable || b.ambiguous || stack.has(b)) throw new Error(`无法静态读取 ${n.name}`);
      usedBindings.add(b);
      return literal(b.node, b.scope, new Set([...stack, b]), depth + 1);
    }
    if (n.type === 'UnaryExpression' && ['-', '+', '!'].includes(n.operator)) {
      const v = literal(n.argument, scope, stack, depth + 1);
      if (n.operator === '!') return !v;
      if (typeof v !== 'number') throw new Error('一元运算只接受数值常量');
      return n.operator === '-' ? -v : v;
    }
    if (n.type === 'ArrayExpression') return n.elements.map(e => literal(e, scope, stack, depth + 1));
    if (n.type === 'ObjectExpression') {
      const out = {};
      for (const p of n.properties) {
        if (p.type === 'SpreadElement') { const extra = literal(p.argument, scope, stack, depth + 1); if (!isObject(extra)) throw new Error('对象展开值不明确'); Object.assign(out, extra); continue; }
        const key = p.computed ? literal(p.key, scope, stack, depth + 1) : keyOf(p.key);
        if (p.kind !== 'init' || p.method || !['string', 'number'].includes(typeof key) || BAD_KEYS.has(String(key))) throw new Error('对象属性不在安全静态子集中');
        out[String(key)] = literal(p.value, scope, stack, depth + 1);
      }
      return out;
    }
    if (n.type === 'MemberExpression') {
      const object = literal(n.object, scope, stack, depth + 1), key = n.computed ? literal(n.property, scope, stack, depth + 1) : keyOf(n.property);
      if (BAD_KEYS.has(String(key)) || !isObject(object) && !Array.isArray(object) || !own(object, key)) throw new Error('无法读取常量成员');
      return jsonCopy(object[key]);
    }
    throw new Error(`动态表达式 ${n.type}`);
  }
  function zPath(n, scope) {
    if (n?.type === 'Identifier') {
      const b = findBinding(n.name, scope);
      if (!b && ['z', 'zod'].includes(n.name)) return [];
      if (b?.imported && /(?:^|[\/@-])zod(?:$|[\/@.-])/.test(b.from) && ['z', '*', 'default'].includes(b.importedName)) return [];
      return null;
    }
    if (n?.type === 'MemberExpression') { const head = zPath(n.object, scope), key = memberName(n); return head && key ? [...head, key] : null; }
    return null;
  }
  const problem = message => { warn(message); return unknown(message); };
  function shape(n, scope, stack, depth) {
    if (n?.type === 'Identifier') {
      const b = findBinding(n.name, scope);
      if (!b?.node || b.mutable || stack.has(b)) throw new Error(`无法读取字段表 ${n.name}`);
      usedBindings.add(b);
      return shape(b.node, b.scope, new Set([...stack, b]), depth + 1);
    }
    if (n?.type !== 'ObjectExpression') throw new Error('字段表不是静态对象');
    const properties = {};
    for (const p of n.properties) {
      try {
        if (p.type === 'SpreadElement') { Object.assign(properties, shape(p.argument, scope, stack, depth + 1)); continue; }
        const key = p.computed ? literal(p.key, scope) : keyOf(p.key);
        if (p.kind !== 'init' || p.method || key === null || BAD_KEYS.has(String(key))) throw new Error('字段名无法静态确认或包含危险键');
        properties[String(key)] = schema(p.value, scope, stack, depth + 1);
      } catch (e) { warn(`部分字段表未读取：${e.message}`); }
    }
    return properties;
  }
  function schema(n, scope, stack = new Set(), depth = 0) {
    if (!n || depth > LIMITS.depth) return problem('结构缺失或嵌套超过检查上限');
    if (n.type === 'Identifier') {
      const b = findBinding(n.name, scope);
      if (!b || b.imported || b.parameter || b.ambiguous || !b.node || stack.has(b)) return problem(`结构引用 ${n.name} 无法读取（外部、动态或循环引用）`);
      usedBindings.add(b);
      if (b.mutable) warn(`结构引用 ${n.name} 不是 const，运行时可能改变`);
      return schema(b.node, b.scope, new Set([...stack, b]), depth + 1);
    }
    if (n.type !== 'CallExpression') return problem(`未支持的结构表达式 ${n.type}`);
    const zp = zPath(n.callee, scope), args = n.arguments;
    if (zp) {
      const method = zp.join('.');
      if (['string', 'number', 'boolean', 'null', 'unknown', 'any', 'never'].includes(method)) return { kind: method === 'unknown' ? 'any' : method };
      if (['coerce.string', 'coerce.number', 'coerce.boolean'].includes(method)) return { kind: method.split('.')[1], coerce: true };
      if (['object', 'strictObject', 'looseObject'].includes(method)) {
        let properties = {};
        try { properties = shape(args[0], scope, stack, depth + 1); } catch (e) { warn(e.message); return { kind: 'object', properties, incomplete: true, unknownKeys: 'preserve' }; }
        return { kind: 'object', properties, unknownKeys: method === 'strictObject' ? 'strict' : method === 'looseObject' ? 'passthrough' : 'preserve' };
      }
      if (method === 'array') return { kind: 'array', element: schema(args[0], scope, stack, depth + 1) };
      if (method === 'record' || method === 'partialRecord') {
        if (args.length === 1) warn('单参数 record 按旧版值结构读取，无法确认当前 Zod 版本语义');
        return { kind: 'record', key: args.length > 1 ? schema(args[0], scope, stack, depth + 1) : { kind: 'string' }, value: schema(args.length > 1 ? args[1] : args[0], scope, stack, depth + 1), exhaustive: method === 'record' && args.length > 1 };
      }
      if (method === 'enum' || method === 'nativeEnum' || method === 'literal') {
        try {
          const v = literal(args[0], scope), values = method === 'literal' ? Array.isArray(v) ? v : [v] : Array.isArray(v) ? v : isObject(v) ? Object.values(v) : null;
          if (!values?.length || values.some(x => x !== null && !['string', 'number', 'boolean'].includes(typeof x))) throw new Error('枚举值不是有限静态列表');
          if (method === 'nativeEnum' && isObject(v) && Object.values(v).some(x => typeof x === 'number')) warn('数字 nativeEnum 的反向映射未完整检查');
          return { kind: 'enum', values };
        } catch (e) { return problem(e.message); }
      }
      if (method === 'union' || method === 'discriminatedUnion') {
        const options = args[method === 'union' ? 0 : 1];
        if (options?.type !== 'ArrayExpression') return problem('联合结构分支不是静态列表');
        return { kind: 'union', options: options.elements.map(v => schema(v, scope, stack, depth + 1)) };
      }
      if (method === 'preprocess') { warn('preprocess 含可执行预处理，未执行；该子树不能完整校验'); return { kind: 'preprocess', inner: schema(args[1], scope, stack, depth + 1) }; }
      if (['optional', 'nullable', 'nullish'].includes(method)) return { kind: method, inner: schema(args[0], scope, stack, depth + 1) };
      return problem(`未支持的 Zod 构造器 ${method}`);
    }
    if (n.callee.type !== 'MemberExpression') return problem(`未执行动态结构函数 ${methodName(n.callee) || n.callee.type}`);
    const inner = schema(n.callee.object, scope, stack, depth + 1), method = memberName(n.callee);
    if (['optional', 'nullable', 'nullish'].includes(method)) return { kind: method, inner };
    if (['default', 'prefault'].includes(method)) {
      try { return { kind: method, inner, value: literal(args[0], scope) }; }
      catch (e) { warn(`${method} 默认值无法静态读取：${e.message}`); return { kind: 'dynamicDefault', inner }; }
    }
    if (method === 'catch') { warn('catch 会改变校验失败时的结果，未执行；该子树保留原值'); return { kind: 'unverifiedCatch', inner }; }
    if (['describe', 'meta', 'brand', 'readonly'].includes(method)) return inner;
    if (['strict', 'passthrough', 'strip', 'catchall'].includes(method) && inner.kind === 'object') return { ...inner, unknownKeys: method === 'strict' ? 'strict' : method === 'passthrough' ? 'passthrough' : method === 'catchall' ? 'catchall' : 'preserve', ...(method === 'catchall' ? { catchall: schema(args[0], scope, stack, depth + 1) } : {}) };
    if (method === 'array') return { kind: 'array', element: inner };
    if (method === 'or') return { kind: 'union', options: [inner, schema(args[0], scope, stack, depth + 1)] };
    if (['min', 'max', 'length', 'gt', 'gte', 'lt', 'lte', 'multipleOf'].includes(method)) {
      try { const value = literal(args[0], scope); if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('界限不是数值常量'); return { kind: 'constraint', inner, method, value }; }
      catch (e) { warn(`${method} 约束未完整检查：${e.message}`); return { kind: 'effect', inner, effect: method }; }
    }
    if (['int', 'nonnegative', 'positive', 'negative', 'nonpositive', 'finite', 'nonempty'].includes(method)) return { kind: 'constraint', inner, method };
    if (method === 'extend' && inner.kind === 'object') {
      try { return { ...inner, properties: { ...inner.properties, ...shape(args[0], scope, stack, depth + 1) } }; }
      catch (e) { warn(`extend 字段未完整读取：${e.message}`); return { ...inner, incomplete: true }; }
    }
    if (method === 'partial' && inner.kind === 'object' && !args.length) return { ...inner, properties: Object.fromEntries(Object.entries(inner.properties).map(([k, v]) => [k, { kind: 'optional', inner: v }])) };
    warn(`${method || '动态方法'} 含未支持的检查或变换，未执行`);
    return { kind: 'effect', inner, effect: method || 'dynamic' };
  }
  let chosen = roots.length ? roots : candidates;
  if (!roots.length && chosen.length) warn('未找到 registerMvuSchema 调用，使用候选结构；无法确认运行时注册目标');
  if (!chosen.length) return { schemas: [], warnings, imports };
  const schemas = chosen.map(r => ({ sourceId: source.id || '', name: source.name || r.label, label: r.label, descriptor: schema(r.node, r.scope) }));
  for (const { node, scope } of mutations) {
    let target = node;
    while (target?.type === 'MemberExpression') target = target.object;
    if (target?.type === 'Identifier' && usedBindings.has(findBinding(target.name, scope))) warn(`结构依赖 ${target.name} 存在运行时赋值，静态定义可能被改变`);
  }
  const passiveMethods = new Set(['registerMvuSchema', 'default', 'prefault', 'min', 'max', 'length', 'enum', 'nativeEnum', 'literal', 'object', 'strictObject', 'looseObject', 'extend', 'record', 'partialRecord', 'array', 'union', 'describe', 'meta']);
  for (const { node, scope } of calls) {
    const name = methodName(node.callee), binding = node.callee.type === 'Identifier' ? findBinding(node.callee.name, scope) : null;
    if (passiveMethods.has(name) || binding?.importedName === 'registerMvuSchema' || zPath(node.callee, scope)) continue;
    if (node.arguments.some(a => a.type === 'Identifier' && usedBindings.has(findBinding(a.name, scope)))) warn(`结构依赖传入了 ${name || '未知调用'}，未执行该调用，无法确认运行时是否修改结构`);
  }
  return { schemas, warnings: unique(warnings), imports };
}

function collectFields(descriptor, path = [], fields = [], depth = 0) {
  if (!descriptor || depth > LIMITS.depth || fields.length >= LIMITS.fields) return fields;
  const wrappers = [], initial = descriptor;
  while (descriptor.inner) { wrappers.push(descriptor.kind); descriptor = descriptor.inner; }
  const field = { path, type: descriptor.kind, optional: wrappers.some(k => ['optional', 'nullish', 'default', 'prefault', 'dynamicDefault'].includes(k)), nullable: wrappers.some(k => ['nullable', 'nullish'].includes(k)) };
  let cursor = initial;
  while (cursor) {
    if (['default', 'prefault'].includes(cursor.kind)) { field.default = cursor.value; field.defaultMode = cursor.kind; }
    if (cursor.kind === 'constraint') (field.constraints ||= []).push({ method: cursor.method, ...(own(cursor, 'value') ? { value: cursor.value } : {}) });
    cursor = cursor.inner;
  }
  if (descriptor.values) field.values = descriptor.values;
  if (wrappers.some(k => ['effect', 'preprocess', 'dynamicDefault', 'unverifiedCatch'].includes(k)) || descriptor.kind === 'unknown' || descriptor.incomplete) field.partial = true;
  fields.push(field);
  if (descriptor.kind === 'object') for (const [k, child] of Object.entries(descriptor.properties)) collectFields(child, [...path, k], fields, depth + 1);
  if (descriptor.kind === 'array') collectFields(descriptor.element, [...path, '*'], fields, depth + 1);
  if (descriptor.kind === 'record') collectFields(descriptor.value, [...path, '*'], fields, depth + 1);
  return fields;
}

export function inspectSchema(sources) {
  const warnings = [], imports = [], schemas = [];
  let total = 0;
  if (!Array.isArray(sources) || !sources.length) return { fields: [], imports, warnings: ['没有可读取的 MVU Zod 源码'], status: 'unavailable', schemas };
  if (sources.length > LIMITS.scripts) return { fields: [], imports, warnings: ['所选脚本数量超过检查上限'], status: 'unavailable', schemas };
  for (const source of sources) {
    if (typeof source?.content !== 'string' || !source.content.trim()) { warnings.push(`${source?.name || '脚本'}没有源码`); continue; }
    total += source.content.length;
    if (source.content.length > LIMITS.source || total > LIMITS.total) { warnings.push('源码大小超过安全检查上限，未完整读取'); continue; }
    try { const r = createReader(source); warnings.push(...r.warnings); imports.push(...r.imports); schemas.push(...r.schemas); }
    catch (e) { warnings.push(`${source.name || source.id || '脚本'}无法解析：${e.message}`); }
  }
  const seen = new Set(), distinct = schemas.filter(s => { const key = JSON.stringify(s.descriptor); if (seen.has(key)) return false; seen.add(key); return true; });
  if (imports.length) warnings.push('依赖模块不会被执行；外部结构引用若未能解析，会标为部分检查');
  if (distinct.length > 1) warnings.push('选中源码包含多个不同根结构，请只选择当前实际使用的一份；当前不能合并校验');
  const fields = distinct.flatMap(s => collectFields(s.descriptor).map(f => ({ ...f, sourceId: s.sourceId })));
  if (fields.length >= LIMITS.fields) warnings.push('字段数量达到检查上限，字段展示可能不完整');
  const known = fields.some(f => f.type !== 'unknown');
  const meaningfulWarnings = warnings.filter(w => !w.startsWith('依赖模块不会被执行'));
  return { fields, imports, warnings: unique(warnings), status: !distinct.length || !known ? 'unavailable' : meaningfulWarnings.length ? 'partial' : 'supported', schemas: distinct };
}

function checkValue(schema, value, path, state, depth = 0) {
  if (++state.nodes > 100000 || depth > LIMITS.depth) { state.errors.push({ path, message: '变量数据超过检查上限' }); return value; }
  const error = message => state.errors.push({ path, message });
  const warning = message => { state.partial = true; state.warnings.push(`${path.length ? path.join('.') : '(根)'}：${message}`); };
  const child = (d, ...args) => checkValue(d, args.length ? args[0] : value, args.length > 1 ? args[1] : path, state, depth + 1);
  if (schema.kind === 'unknown') { warning(schema.reason || '未知结构'); return value; }
  if (schema.kind === 'preprocess') { warning('未执行预处理，保留原值，此子树未校验'); return value; }
  if (schema.kind === 'unverifiedCatch') { warning('未执行 catch 回退，保留原值，此子树未完整校验'); return value; }
  if (schema.kind === 'effect') { warning(`未执行 ${schema.effect}，仅检查已知的输入结构`); return child(schema.inner); }
  if (schema.kind === 'dynamicDefault') { warning('默认值含动态代码，未执行'); return value === undefined ? value : child(schema.inner); }
  if (schema.kind === 'default') return value === undefined ? jsonCopy(schema.value) : child(schema.inner);
  if (schema.kind === 'prefault') return child(schema.inner, value === undefined ? jsonCopy(schema.value) : value);
  if (schema.kind === 'optional' || schema.kind === 'nullish') {
    if (value === undefined) {
      let wrapped = schema.inner;
      while (wrapped && !['default', 'prefault', 'dynamicDefault'].includes(wrapped.kind)) wrapped = wrapped.inner;
      return wrapped ? child(schema.inner) : undefined;
    }
    if (value === null && schema.kind === 'nullish') return null;
    return child(schema.inner);
  }
  if (schema.kind === 'nullable') return value === null ? null : child(schema.inner);
  if (schema.kind === 'constraint') {
    const count = state.errors.length, out = child(schema.inner);
    if (state.errors.length !== count) return out;
    const size = typeof out === 'number' ? out : typeof out === 'string' || Array.isArray(out) ? out.length : null;
    const m = schema.method, n = schema.value;
    let ok;
    if (['min', 'gte'].includes(m)) ok = size !== null && size >= n;
    else if (['max', 'lte'].includes(m)) ok = size !== null && size <= n;
    else if (m === 'length') ok = size !== null && size === n;
    else if (m === 'gt') ok = typeof out === 'number' && out > n;
    else if (m === 'lt') ok = typeof out === 'number' && out < n;
    else if (m === 'int') ok = typeof out === 'number' && Number.isSafeInteger(out);
    else if (m === 'finite') ok = typeof out === 'number' && Number.isFinite(out);
    else if (m === 'nonnegative') ok = typeof out === 'number' && out >= 0;
    else if (m === 'positive') ok = typeof out === 'number' && out > 0;
    else if (m === 'negative') ok = typeof out === 'number' && out < 0;
    else if (m === 'nonpositive') ok = typeof out === 'number' && out <= 0;
    else if (m === 'nonempty') ok = size !== null && size >= 1;
    else if (m === 'multipleOf') { const ratio = out / n; ok = typeof out === 'number' && n !== 0 && Math.abs(ratio - Math.round(ratio)) < Number.EPSILON * Math.max(Math.abs(ratio), 1); }
    if (!ok) error(`不满足 ${m}${n === undefined ? '' : `(${n})`} 约束`);
    return out;
  }
  if (schema.kind === 'union') {
    const results = schema.options.map(option => {
      const branch = { errors: [], warnings: [], partial: false, nodes: 0 };
      const data = checkValue(option, value, path, branch, depth + 1);
      return { data, ...branch };
    });
    const good = results.find(r => !r.errors.length && !r.partial) || results.find(r => !r.errors.length);
    if (!good) { error('不符合任何已知联合结构分支'); return value; }
    if (good.partial) { state.partial = true; state.warnings.push(...good.warnings); }
    return good.data;
  }
  if (value === undefined) { error('缺少必填字段'); return undefined; }
  if (schema.coerce) {
    if (schema.kind === 'string') value = String(value);
    if (schema.kind === 'number') value = Number(value);
    if (schema.kind === 'boolean') value = Boolean(value);
  }
  if (schema.kind === 'string' || schema.kind === 'boolean' || schema.kind === 'number') {
    if (typeof value !== schema.kind || schema.kind === 'number' && !Number.isFinite(value)) error(`需要 ${schema.kind} 类型`);
    return Number.isNaN(value) || value === Infinity || value === -Infinity ? null : value;
  }
  if (schema.kind === 'null') { if (value !== null) error('必须为 null'); return value; }
  if (schema.kind === 'never') { error('此字段不允许任何值'); return value; }
  if (schema.kind === 'unknown' || schema.kind === 'any') return value;
  if (schema.kind === 'enum') { if (!schema.values.some(v => Object.is(v, value))) error(`不在允许值中：${schema.values.map(String).join('、')}`); return value; }
  if (schema.kind === 'array') {
    if (!Array.isArray(value)) { error('需要数组'); return value; }
    return value.map((v, i) => child(schema.element, v, [...path, String(i)]));
  }
  if (schema.kind === 'object') {
    if (!isObject(value)) { error('需要对象'); return value; }
    const out = jsonCopy(value);
    if (schema.incomplete) warning('字段表只读取了部分内容');
    for (const [k, d] of Object.entries(schema.properties)) {
      const next = child(d, own(value, k) ? value[k] : undefined, [...path, k]);
      if (next !== undefined) out[k] = next;
    }
    for (const k of Object.keys(value)) if (!own(schema.properties, k)) {
      if (schema.unknownKeys === 'strict') state.errors.push({ path: [...path, k], message: '严格对象不允许此额外字段；原值仍保留，需明确处理' });
      else if (schema.unknownKeys === 'catchall') out[k] = child(schema.catchall, value[k], [...path, k]);
      else if (schema.unknownKeys !== 'passthrough') warning(`额外字段 ${k} 已保留；原 Zod 默认可能移除它，需明确处理`);
    }
    return out;
  }
  if (schema.kind === 'record') {
    if (!isObject(value)) { error('需要动态键对象'); return value; }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const checkedKey = child(schema.key, k, [...path, k]);
      if (String(checkedKey) !== k) warning(`动态键 ${k} 需要转换；保留原键，未自动重命名`);
      out[k] = child(schema.value, v, [...path, k]);
    }
    if (schema.exhaustive && schema.key.kind === 'enum') for (const key of schema.key.values) {
      const k = String(key);
      if (!own(value, k)) { const next = child(schema.value, undefined, [...path, k]); if (next !== undefined) out[k] = next; }
    }
    return out;
  }
  warning(`未支持的结构类型 ${schema.kind}`);
  return value;
}

export function validateSchema(sources, data) {
  let copy;
  try { copy = jsonCopy(data); }
  catch (e) { return { status: 'failed', data: null, errors: [{ path: [], message: e.message }], warnings: [] }; }
  const report = inspectSchema(sources);
  if (report.status === 'unavailable') return { status: 'unavailable', data: copy, errors: [], warnings: report.warnings };
  if (report.schemas.length !== 1) return { status: 'partial', data: copy, errors: [], warnings: report.warnings };
  const state = { errors: [], warnings: [...report.warnings], partial: report.status === 'partial', nodes: 0 };
  const result = checkValue(report.schemas[0].descriptor, copy, [], state);
  return { status: state.errors.length ? 'failed' : state.partial ? 'partial' : 'passed', data: result, errors: state.errors, warnings: unique(state.warnings) };
}
