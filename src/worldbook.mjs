import { normalizeRules, fingerprint } from './core.mjs';

// Discovery only suggests entries. Additional worldbooks are read on explicit selection.
export function ruleCandidate(entry) {
  const name = entry.name || '', content = entry.content || '';
  if (/变量.*(?:规则|更新|定义|说明|列表|初始化)|(?:规则|更新).*变量|mvu|variable[\s_-]*(?:update|rules?)|update[\s_-]*rules?/i.test(name)) return true;
  return /变量更新规则|<\/?(?:variable_update|updatevariable|variable_rules)>|(?:variable_update_rules|变量更新规则)\s*:/i.test(content);
}

async function bindings(api) {
  const books = new Map(), warnings = [];
  const add = (name, scope) => { if (typeof name === 'string' && name.trim()) { const scopes = books.get(name) || []; if (!scopes.includes(scope)) scopes.push(scope); books.set(name, scopes); } };
  if (typeof api.getCharWorldbookNames === 'function') {
    try { const names = await api.getCharWorldbookNames('current'); if (!names || !Array.isArray(names.additional)) throw new Error('绑定信息格式异常'); add(names.primary, '角色主世界书'); names.additional.forEach(name => add(name, '角色附加世界书')); }
    catch (error) { warnings.push('角色世界书绑定未读到：' + String(error.message || error)); }
  } else warnings.push('缺少角色世界书读取接口，请手动提供变量更新规则。');
  if (typeof api.getChatWorldbookName === 'function') {
    try { add(await api.getChatWorldbookName('current'), '聊天世界书'); }
    catch (error) { warnings.push('聊天世界书绑定未读到：' + String(error.message || error)); }
  } else warnings.push('缺少聊天世界书绑定接口，未检查聊天附加规则。');
  const list = [...books].map(([name, scopes]) => ({ name, scopes })).sort((a, b) => a.name.localeCompare(b.name));
  if (list.length > 32) throw new Error('关联世界书超过 32 本，请减少关联后重新读取，或手动提供规则。');
  return { books: list, warnings, signature: fingerprint({ books: list, warnings }) };
}

function entryText(value) { return typeof value === 'string' ? value : String(value); }
function projectEntry(book, entry) {
  if (!Number.isSafeInteger(entry?.uid) || typeof entry.content !== 'string') throw new Error('条目编号或正文格式异常');
  const strategy = entry.strategy || {};
  const hostOptions = {};
  for (const key of ['group', 'groupOverride', 'groupWeight', 'caseSensitive', 'matchWholeWords', 'useGroupScoring', 'automationId', 'ignoreBudget', 'outletName', 'triggers', 'characterFilter', 'matchPersonaDescription', 'matchCharacterDescription', 'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes', 'extra']) {
    if (entry[key] !== undefined) hostOptions[key] = entry[key];
  }
  const activation = { type: strategy.type || 'unknown', keys: (strategy.keys || []).map(entryText),
    secondary: { logic: strategy.keys_secondary?.logic || '', keys: (strategy.keys_secondary?.keys || []).map(entryText) },
    scanDepth: strategy.scan_depth ?? null, probability: entry.probability ?? null, position: entry.position || null,
    recursion: entry.recursion || null, effect: entry.effect || null, hostOptions };
  return normalizeRules([{ id: JSON.stringify([book, entry.uid]), worldbook: book, uid: entry.uid,
    name: typeof entry.name === 'string' ? entry.name : '未命名条目', content: entry.content, enabled: entry.enabled !== false, activation }])[0];
}

export async function readWorldbookRules(api) {
  const before = await bindings(api), warnings = [...before.warnings], entries = [];
  if (typeof api.getWorldbook !== 'function') warnings.push('缺少世界书条目读取接口，请手动提供变量更新规则。');
  else {
    const results = await Promise.allSettled(before.books.map(async book => {
      const rows = await api.getWorldbook(book.name);
      if (!Array.isArray(rows) || rows.length > 5000) throw new Error('条目列表异常或超过 5000 项');
      const rules = rows.map(row => projectEntry(book.name, row));
      if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new Error('同一本世界书存在重复编号');
      return normalizeRules(rules).map(rule => ({ ...rule, candidate: ruleCandidate(rule), scopes: book.scopes }));
    }));
    results.forEach((result, index) => { if (result.status === 'fulfilled') entries.push(...result.value); else warnings.push(`世界书“${before.books[index].name}”未读到：${String(result.reason?.message || result.reason)}`); });
  }
  const after = await bindings(api);
  if (before.signature !== after.signature) throw new Error('读取期间关联世界书发生变化，请重新读取。');
  if (entries.length > 5000) throw new Error('关联条目总数超过 5000 项，请减少关联后重新读取，或手动提供规则。');
  return { entries, books: before.books, warnings, bindingSignature: before.signature };
}

export async function readWorldbookCatalog(api, boundBooks = []) {
  const books = new Map(boundBooks.map(book => [book.name, { ...book }])), warnings = [];
  if (typeof api.getWorldbookNames !== 'function') warnings.push('缺少世界书列表接口，暂时只能选择已关联的世界书。');
  else try {
    const names = await api.getWorldbookNames();
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw new Error('世界书名称列表格式异常');
    for (const name of names) if (name.trim() && !books.has(name)) books.set(name, { name, scopes: [] });
  } catch (error) { warnings.push('世界书列表未读到：' + String(error.message || error)); }
  return { books: [...books.values()].sort((a, b) => Number(!!b.scopes.length) - Number(!!a.scopes.length) || a.name.localeCompare(b.name, 'zh-CN')), warnings };
}

export async function readWorldbookEntries(api, name) {
  if (typeof api.getWorldbook !== 'function') throw new Error('缺少世界书条目读取接口。');
  const rows = await api.getWorldbook(name);
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error('条目列表异常或超过 5000 项');
  const entries = normalizeRules(rows.map(row => projectEntry(name, row)));
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('同一本世界书存在重复编号');
  return entries.map(entry => ({ ...entry, candidate: ruleCandidate(entry) }));
}

export function selectedRuleWarnings(snapshot, rules) {
  const warnings = [...(snapshot?.warnings || [])];
  if (!rules.length) warnings.push('本次没有选用新版世界书变量更新规则，字段含义和变化条件缺少这部分依据。');
  if (rules.some(rule => rule.enabled === false)) warnings.push('选用了未启用的世界书条目，需要确认其版本和适用条件。');
  if (rules.some(rule => rule.uid === null)) warnings.push('手动提供的规则未与目标卡的实际世界书条目核对。');
  if (rules.some(rule => /<%|\{\{/.test(rule.content))) warnings.push('世界书规则含宏或模板，只读取原文，没有执行或展开动态内容。');
  return warnings;
}

export async function assertRulesCurrent(api, snapshot, selected) {
  if (!snapshot) throw new Error('请先读取目标世界书。');
  const current = await bindings(api);
  if (current.signature !== snapshot.bindingSignature) throw new Error('关联世界书发生变化，请重新读取并分析。');
  const external = selected.filter(rule => rule.uid !== null);
  if (!external.length) return;
  if (typeof api.getWorldbook !== 'function') throw new Error('世界书读取接口不可用，不能核对旧预览。');
  const names = [...new Set(external.map(rule => rule.worldbook))];
  const results = await Promise.all(names.map(async name => ({ name, entries: await api.getWorldbook(name) })));
  const fresh = external.map(rule => {
    const rows = results.find(book => book.name === rule.worldbook).entries;
    const matches = Array.isArray(rows) ? rows.filter(row => row.uid === rule.uid) : [];
    if (matches.length !== 1) throw new Error('所选世界书条目已移除或编号重复，请重新读取并分析。');
    return projectEntry(rule.worldbook, matches[0]);
  });
  if (fingerprint(normalizeRules(external)) !== fingerprint(fresh)) throw new Error('所选世界书规则或启用条件已变化，请重新读取并分析。');
  if ((await bindings(api)).signature !== snapshot.bindingSignature) throw new Error('核对期间关联世界书发生变化，请重新读取并分析。');
}
