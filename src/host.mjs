import { cloneJson, fingerprint, stableStringify, assertJson, parseJsonResponse } from './core.mjs';
import { parse } from './vendor/acorn.mjs';

export const TOOL_VERSION = '0.5.1';
export const BACKUP_KEY = 'mvu-zod-migrator.backups.v1';
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uid = () => globalThis.crypto?.randomUUID?.() || `migration-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Core GENERATION_STARTED also fires for dry runs and early exits. Prefer the
// host's current state over a latched event; events are only a fallback.
export function observeGeneration({ context, getProbe = () => undefined }) {
  let observed = false;
  const ctx = context(), cleanups = [];
  const listen = (name, handler) => {
    const event = ctx.eventTypes?.[name];
    if (!event || !ctx.eventSource?.on || !ctx.eventSource?.removeListener) return;
    ctx.eventSource.on(event, handler);
    cleanups.push(() => ctx.eventSource.removeListener(event, handler));
  };
  listen('GENERATION_STARTED', (_type, _options, dryRun) => { if (dryRun !== true) observed = true; });
  listen('GENERATION_ENDED', () => { observed = false; });
  // Helper passes a generation ID when stopping an independent request.
  listen('GENERATION_STOPPED', id => { if (typeof id !== 'string' || !id) observed = false; });
  listen('CHAT_CHANGED', () => { observed = false; });
  return {
    busy() {
      const probe = getProbe();
      if (typeof probe === 'function') {
        try { const active = probe(); if (typeof active === 'boolean') { observed = active; return active; } } catch {}
      }
      const stream = context().streamingProcessor;
      return observed || Boolean(stream && stream.isFinished === false && stream.isStopped !== true && stream.abortController?.signal?.aborted !== true);
    },
    destroy() { cleanups.splice(0).forEach(fn => fn()); observed = false; }
  };
}

export function makeHost({ api, context, storage, generationBusy, now = () => new Date().toISOString() }) {
  let writing = false;
  function identity() {
    const ctx = context();
    if (ctx.groupId != null && ctx.groupId !== '') throw new Error('首版仅支持单角色聊天，请切换到目标角色卡。');
    const character = ctx.characters?.[ctx.characterId];
    const chat = ctx.getCurrentChatId?.() ?? ctx.chatId;
    if (ctx.characterId == null || !chat || !Array.isArray(ctx.chat)) throw new Error('请先打开一个角色卡聊天。');
    return { key: stableStringify([String(character?.avatar || ctx.characterId), String(chat)]), label: `${character?.name || ctx.name2 || '当前角色'} / ${chat}`, chatLength: ctx.chat.length };
  }
  function sameChat(target) {
    const current = identity();
    if (current.key !== target.identity || current.chatLength !== target.chatLength) throw new Error('聊天或消息数量已改变，请重新读取并分析。');
  }
  function busy() {
    if (generationBusy) return generationBusy();
    const ctx = context();
    return ctx.migrationObservedGeneration === true || Boolean(ctx.streamingProcessor && ctx.streamingProcessor.isFinished === false && ctx.streamingProcessor.isStopped !== true);
  }
  function assertIdle() {
    if (busy()) throw new Error('酒馆正在生成回复。结束后可直接重试写入。');
  }
  function nativeState(floor) {
    const row = context().chat?.[floor];
    if (!row) throw new Error('所选楼层已不存在。');
    const swipe = row.swipe_id ?? 0;
    const variables = row.variables?.[swipe];
    if (!object(variables)) throw new Error('无法同步核对该楼层变量，请更新酒馆助手并重新读取。');
    return { swipe, nativeMessageHash: fingerprint([row.name || '', Boolean(row.is_user), Boolean(row.is_system), row.mes || '', row.swipes?.length ?? 1]), variablesHash: fingerprint(variables) };
  }
  function assertNative(target) {
    sameChat(target);
    const actual = nativeState(target.floor);
    if (actual.swipe !== target.swipe || actual.nativeMessageHash !== target.nativeMessageHash || actual.variablesHash !== target.variablesHash) throw new Error('目标分支、消息或变量已变化，写入已取消。');
  }
  async function read(floor = -1) {
    const start = identity();
    if (!api.getVariables || !api.getChatMessages) throw new Error('酒馆助手缺少读取变量或消息接口，请更新酒馆助手。');
    let index = Number(floor);
    if (!Number.isInteger(index) || index < -1) throw new Error('楼层号必须是非负整数，或 -1 自动选择最新有效状态。');
    if (index === -1) {
      index = -1;
      for (let i = start.chatLength - 1; i >= 0; i--) {
        const table = await api.getVariables({ type: 'message', message_id: i });
        sameChat({ identity: start.key, chatLength: start.chatLength });
        if (object(table?.stat_data)) { index = i; break; }
      }
      if (index < 0) throw new Error('当前聊天没有可读取的 stat_data，请选择已有 MVU 存档的聊天。工具不会初始化变量。');
    }
    if (index >= start.chatLength) throw new Error('所选楼层不存在。');
    const nativeBefore = nativeState(index);
    const rows = await api.getChatMessages(index, { include_swipes: true });
    sameChat({ identity: start.key, chatLength: start.chatLength });
    const row = rows?.find(item => item.message_id === index);
    if (!row) throw new Error('无法读取所选楼层。');
    const swipe = row.swipe_id ?? 0;
    const variables = cloneJson(await api.getVariables({ type: 'message', message_id: index }));
    sameChat({ identity: start.key, chatLength: start.chatLength });
    const nativeAfter = nativeState(index);
    if (fingerprint(nativeAfter) !== fingerprint(nativeBefore) || swipe !== nativeAfter.swipe || fingerprint(variables) !== nativeAfter.variablesHash) throw new Error('读取期间分支或变量发生变化，请重新读取。');
    if (!object(variables.stat_data)) throw new Error('所选楼层没有对象形式的 stat_data。');
    const target = { identity: start.key, label: start.label, floor: index, swipe, chatLength: start.chatLength,
      messageHash: fingerprint([row.name, row.role, row.swipes?.[swipe] ?? row.message ?? '', row.swipes?.length ?? 1]),
      nativeMessageHash: nativeAfter.nativeMessageHash,
      variablesHash: fingerprint(variables) };
    return { target, variables };
  }
  async function assertCurrent(snapshot) {
    sameChat(snapshot.target);
    const current = await read(snapshot.target.floor);
    for (const key of ['identity', 'floor', 'swipe', 'chatLength', 'messageHash', 'nativeMessageHash', 'variablesHash']) {
      if (current.target[key] !== snapshot.target[key]) throw new Error('目标聊天、分支或变量已变化，旧预览已失效，请重新分析。');
    }
    return current;
  }
  function backups() {
    const raw = storage.getItem(BACKUP_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('本地备份目录损坏，请先导出浏览器存储排查。');
    return value;
  }
  function persist(record) {
    assertJson(record);
    const list = backups();
    const i = list.findIndex(item => item.id === record.id);
    if (i >= 0) list[i] = record; else list.push(record);
    const text = JSON.stringify(list);
    storage.setItem(BACKUP_KEY, text);
    if (storage.getItem(BACKUP_KEY) !== text) throw new Error('备份写入校验失败，本次不会继续写入聊天。');
  }
  function importBackup(text) {
    const record = cloneJson(parseJsonResponse(text));
    if (record.format !== 'mvu-zod-migration-backup' || record.version !== 1 || typeof record.id !== 'string' || !record.id || record.id.length > 150 || !object(record.target) || !object(record.beforeVariables?.stat_data) || !object(record.afterVariables?.stat_data)) throw new Error('这不是受支持的迁移备份文件。');
    for (const key of ['identity', 'messageHash', 'nativeMessageHash', 'variablesHash', 'label']) if (typeof record.target[key] !== 'string') throw new Error('备份缺少目标标识。');
    for (const key of ['floor', 'swipe', 'chatLength']) if (!Number.isSafeInteger(record.target[key]) || record.target[key] < 0) throw new Error('备份的楼层信息无效。');
    if (fingerprint(record.beforeVariables) !== record.target.variablesHash || fingerprint(record.afterVariables) !== record.afterHash) throw new Error('备份内容与记录的指纹不一致，未导入。');
    const prior = backups().find(item => item.id === record.id);
    if (prior && (fingerprint(prior.beforeVariables) !== fingerprint(record.beforeVariables) || prior.afterHash !== record.afterHash || fingerprint(prior.target) !== fingerprint(record.target))) throw new Error('备份编号与已有不同内容冲突，未导入。');
    record.status = 'prepared'; persist(record); return record;
  }
  async function saveVariables(target, variables) {
    assertIdle();
    assertNative(target);
    if (!api.replaceVariables) throw new Error('酒馆助手缺少变量写入接口。');
    const ctx = context();
    if (typeof ctx.saveChat !== 'function') throw new Error('宿主没有可用的聊天保存接口，本次不写入。');
    // No await between this synchronous state check and the latest Helper's synchronous write.
    assertNative(target); assertIdle();
    await api.replaceVariables(variables, { type: 'message', message_id: target.floor });
    sameChat(target);
    await ctx.saveChat();
    sameChat(target);
    const reread = await read(target.floor);
    if (reread.target.swipe !== target.swipe || reread.target.messageHash !== target.messageHash || reread.target.nativeMessageHash !== target.nativeMessageHash || fingerprint(reread.variables) !== fingerprint(variables)) {
      throw new Error('写入后读回不一致，请检查目标聊天；已保留迁移前备份。');
    }
    return reread;
  }
  async function commit({ snapshot, statData, metadata = {} }) {
    if (writing) throw new Error('正在保存，请等待本次操作结束。');
    assertIdle();
    assertJson(statData);
    if (!object(statData)) throw new Error('迁移结果必须是对象。');
    writing = true;
    let record;
    try {
      const current = await assertCurrent(snapshot);
      const next = cloneJson(current.variables);
      next.stat_data = cloneJson(statData);
      if (fingerprint(next) === current.target.variablesHash) return { unchanged: true, snapshot: current };
      record = { format: 'mvu-zod-migration-backup', version: 1, id: uid(), createdAt: now(), status: 'prepared',
        target: cloneJson(current.target), beforeVariables: current.variables, afterVariables: next,
        afterHash: fingerprint(next), metadata: cloneJson(metadata) };
      persist(record);
      await assertCurrent(snapshot);
      const saved = await saveVariables(current.target, next);
      record.status = 'committed'; record.committedAt = now();
      persist(record);
      return { record, snapshot: saved };
    } catch (error) {
      if (record) {
        try {
          const actual = await read(record.target.floor);
          if (actual.target.identity === record.target.identity && actual.target.swipe === record.target.swipe && actual.target.messageHash === record.target.messageHash && actual.target.nativeMessageHash === record.target.nativeMessageHash && actual.target.chatLength === record.target.chatLength) {
            if (fingerprint(actual.variables) === record.afterHash) {
              await saveVariables(actual.target, record.beforeVariables);
              record.status = 'rolled-back';
            } else record.status = fingerprint(actual.variables) === record.target.variablesHash ? 'not-applied' : 'uncertain';
          } else record.status = 'uncertain';
          persist(record);
        } catch { /* Keep the prepared backup: recovery is guarded by target and afterHash. */ }
      }
      throw error;
    } finally { writing = false; }
  }
  async function restore(id) {
    if (writing || busy()) throw new Error('当前正在保存或生成，请稍后恢复。');
    const record = backups().find(item => item.id === id);
    if (!record) throw new Error('找不到该备份。');
    assertJson(record);
    writing = true;
    try {
      sameChat(record.target);
      const actual = await read(record.target.floor);
      if (actual.target.swipe !== record.target.swipe || actual.target.messageHash !== record.target.messageHash || actual.target.nativeMessageHash !== record.target.nativeMessageHash) throw new Error('楼层或分支已改变，不能覆盖。');
      if (fingerprint(actual.variables) === record.target.variablesHash) return { unchanged: true, snapshot: actual };
      if (fingerprint(actual.variables) !== record.afterHash) throw new Error('迁移后又有新变化，直接恢复会覆盖这些变化；请导出备份后单独处理。');
      const restored = await saveVariables(actual.target, record.beforeVariables);
      record.status = 'restored'; record.restoredAt = now(); persist(record);
      return { record, snapshot: restored };
    } finally { writing = false; }
  }
  return { identity, read, assertCurrent, commit, restore, backups, importBackup, busy };
}

export function makeModelClient(api) {
  let active = null;
  function stop(id) { try { Promise.resolve(api.stopGenerationById?.(id)).catch(() => {}); } catch {} }
  function cancel() { if (active) { active.cancelled = true; stop(active.id); active.reject?.(new Error('分析已取消。')); active = null; } }
  async function request(prompt, config, signal) {
    if (!api.generateRaw) throw new Error('酒馆助手缺少独立生成接口，请更新酒馆助手。');
    if (active) throw new Error('已有分析正在进行。');
    if (prompt.system.length + prompt.user.length > 300000) throw new Error('本次源码、世界书规则与变量超过 30 万字符，请减少所选资料或拆分存档后分析。内容未截断，也未发送。');
    const custom = {};
    if (config.mode === 'custom') {
      const url = new URL(config.url);
      if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('API 地址必须是 HTTP(S)，且不能包含用户名或密码。');
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程 API 请使用 HTTPS。');
      if (!config.model?.trim()) throw new Error('请填写迁移分析模型。');
      Object.assign(custom, { apiurl: url.href, key: config.key || '', source: 'openai', model: config.model.trim() });
    } else if (config.model?.trim()) custom.model = config.model.trim();
    const operation = { id: uid(), cancelled: false, reject: null };
    active = operation;
    const listener = () => { if (active === operation) cancel(); };
    signal?.addEventListener('abort', listener, { once: true });
    try {
      if (signal?.aborted) throw new Error('分析已取消。');
      // The player or host ends the request; slow models have no script-side deadline.
      const waiting = new Promise((_, reject) => { operation.reject = reject; });
      const generation = api.generateRaw({ generation_id: operation.id, should_stream: false, should_silence: true,
        max_chat_history: 0, ordered_prompts: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        overrides: { world_info_before: '', world_info_after: '', char_description: '', char_personality: '', persona_description: '', scenario: '', dialogue_examples: '', chat_history: { prompts: [], with_depth_entries: false, author_note: '' } },
        ...(Object.keys(custom).length ? { custom_api: custom } : {}),
        ...(config.structured ? { json_schema: { name: 'mvu_migration_plan', strict: false, value: PLAN_RESPONSE_SCHEMA } } : {}) });
      const result = await Promise.race([generation, waiting]);
      if (operation.cancelled || signal?.aborted) throw new Error('分析已取消，迟到结果已丢弃。');
      const text = typeof result === 'string' ? result : result?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('模型没有返回迁移方案。');
      if (text.length > 1000000) throw new Error('模型回复过长，请重试。');
      return text;
    } catch (error) {
      let message = String(error?.message || '模型请求失败');
      if (config.key) message = message.split(config.key).join('[已隐藏密钥]');
      throw new Error(message.slice(0, 1200));
    } finally { signal?.removeEventListener('abort', listener); if (active === operation) active = null; }
  }
  return { request, cancel };
}

export const PLAN_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['version', 'summary', 'operations', 'questions', 'warnings'],
  properties: { version: { type: 'integer', const: 1 }, summary: { type: 'string' },
    operations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'path', 'reason'], properties: { op: { type: 'string', enum: ['set', 'move', 'remove'] }, path: { type: 'array', items: { type: 'string' } }, from: { type: 'array', items: { type: 'string' } }, value: {}, reason: { type: 'string' } } } },
    questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'question', 'path', 'options'], properties: { id: { type: 'string' }, question: { type: 'string' }, path: { type: 'array', items: { type: 'string' } }, options: { type: 'array', items: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: {} }, additionalProperties: false } } } } },
    warnings: { type: 'array', items: { type: 'string' } } }
};

const IMPORT_HOSTS = new Set(['cdn.jsdelivr.net', 'testingcf.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'raw.githubusercontent.com', 'unpkg.com', 'esm.sh']);
export async function resolveDependencies(sources, { fetcher = globalThis.fetch, signal } = {}) {
  const output = sources.map(source => ({ ...source }));
  const warnings = [];
  const seen = new Set();
  let bytes = output.reduce((n, item) => n + item.content.length, 0);
  function imports(text) {
    let ast;
    try { ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' }); } catch { return []; }
    const found = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && typeof node.source?.value === 'string') found.push(node.source.value);
      for (const [key, value] of Object.entries(node)) if (key !== 'source' && typeof value === 'object') { if (Array.isArray(value)) value.forEach(walk); else walk(value); }
    }
    walk(ast); return found;
  }
  for (let i = 0; i < output.length && i < 9; i++) {
    for (const raw of imports(output[i].content)) {
      if (/^(zod(?:\/.*)?|lodash(?:-es)?)$/.test(raw) || /\/mvu_zod\.(?:js|ts)(?:\?|$)/.test(raw)) continue;
      let url;
      try { url = new URL(raw, output[i].url); } catch { warnings.push(`未读取模块依赖：${raw}`); continue; }
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      if (url.protocol !== 'https:' || !IMPORT_HOSTS.has(url.hostname) || url.username || url.password || url.port) { warnings.push(`外部依赖需手动提供源码：${raw}`); continue; }
      if (output.length >= 9 || bytes >= 250000) { warnings.push('依赖读取达到上限，仍有模块未读取。'); continue; }
      const abort = new AbortController();
      const stop = () => abort.abort(); signal?.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(stop, 8000);
      try {
        if (signal?.aborted) throw new Error('已取消');
        const response = await fetcher(url.href, { signal: abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const length = Number(response.headers?.get('content-length') || 0);
        if (length > 150000) throw new Error('源码超过读取上限');
        let content = '';
        if (response.body?.getReader) {
          const reader = response.body.getReader(); const decoder = new TextDecoder();
          for (;;) { const { value, done } = await reader.read(); if (done) break; content += decoder.decode(value, { stream: true }); if (content.length > 150000) { await reader.cancel(); throw new Error('源码超过读取上限'); } }
          content += decoder.decode();
        } else content = await response.text();
        if (content.length > 150000 || bytes + content.length > 250000) throw new Error('源码总量超过读取上限');
        bytes += content.length;
        output.push({ id: `dependency:${url.href}`, name: url.pathname.split('/').pop() || '依赖模块', content, enabled: true, url: url.href, dependency: true });
      } catch (error) { if (signal?.aborted) throw new Error('分析已取消。'); warnings.push(`依赖未读取：${url.href}（${String(error.message).slice(0, 100)}）`); }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
    }
  }
  return { sources: output, warnings };
}
