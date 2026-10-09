import test from 'node:test';
import assert from 'node:assert/strict';
import { mountUI } from '../src/ui.mjs';

// A small DOM double checks action/state contracts, not browser layout or accessibility.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.parentNode = null;
    this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this._text = ''; this.value = ''; this.className = ''; this.style = {};
    this.hidden = false; this.disabled = false; this.checked = false;
    this.classList = { add: (...names) => { this.className += ' ' + names.join(' '); } };
  }
  append(...items) { for (const item of items) { item.remove?.(); item.parentNode = this; this.children.push(item); if (this.tagName === 'SELECT' && this.children.length === 1) this.value = item.value; } }
  replaceChildren(...items) { this.children.forEach(item => { item.parentNode = null; }); this.children = []; this._text = ''; this.append(...items); }
  get childNodes() { return this.children; }
  get lastChild() { return this.children.at(-1); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(item => item.textContent).join(''); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  attachShadow() { this.shadowRoot = new Element('shadow-root', this.ownerDocument); this.shadowRoot.host = this; return this.shadowRoot; }
  addEventListener(type, callback) { const list = this.listeners.get(type) || new Set(); list.add(callback); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type) { const event = { key: '', preventDefault() {}, stopPropagation() {}, target: this }; for (const callback of this.listeners.get(type) || []) callback(event); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { let node = this; while (node.parentNode) node = node.parentNode; if (node.host) { node.activeElement = this; this.ownerDocument.activeElement = node.host; } else this.ownerDocument.activeElement = this; }
  get isConnected() { let node = this; while (node.parentNode) node = node.parentNode; return node === this.ownerDocument.body || !!node.host?.isConnected; }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (selector === '[hidden]' && node.hidden) return node; return null; }
  querySelectorAll(selector) { const tags = selector.split(','); const found = []; const walk = node => { for (const child of node.children) { if (tags.some(tag => tag === child.tagName.toLowerCase() || tag === '[tabindex="0"]' && child.tabIndex === 0)) found.push(child); walk(child); } }; walk(this); return found; }
  getClientRects() { return this.closest('[hidden]') ? [] : [{}]; }
  checkValidity() { return this.type !== 'number' || Number.isInteger(Number(this.value)) && Number(this.value) >= -1; }
  reportValidity() {}
  showModal() { this.setAttribute('open', ''); }
  close() { this.removeAttribute('open'); }
  scrollIntoView() {}
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.parentNode = null; } }
}
function documentDouble() { const document = { createElement(tag) { return new Element(tag, this); } }; document.body = new Element('body', document); document.activeElement = null; return document; }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup(actions = {}) {
  const document = documentDouble(), ui = mountUI({ document, actions }), shadow = ui.root.shadowRoot;
  const button = label => shadow.querySelectorAll('button').find(item => item.textContent === label);
  const control = label => { const field = shadow.querySelectorAll('label').find(item => item.children[0]?.textContent === label); return field?.children[1]; };
  const checkbox = text => shadow.querySelectorAll('label').find(item => item.textContent.startsWith(text))?.children[0];
  return { document, ui, shadow, button, control, checkbox };
}
const base = { phase: 'preview', source: { label: '旧存档', fieldCount: 1 }, target: { label: '目标', floor: 2, swipe: 0 }, scripts: [], selectedIds: [], backups: [], busy: false, canApply: true, schema: { status: 'passed', errors: [], warnings: [] }, preview: { summary: '保留旧进度', changes: [{ path: ['金币'], kind: 'change', before: 1, after: 2 }], unresolved: [], questions: [], answers: {}, warnings: [] } };

test('render accepts missing optional state and malformed optional collection entries', () => {
  const { ui } = setup();
  assert.doesNotThrow(() => ui.render());
  assert.doesNotThrow(() => ui.render({ ...base, scripts: [null], backups: [null], schema: { errors: [null] }, preview: { questions: [null, { options: [null] }], changes: [null], targetChanges: [null] } }));
  ui.destroy(); assert.equal(ui.root.isConnected, false);
});

test('current connection never sends a retained custom model, URL or secret', async () => {
  const calls = [], { ui, button, control } = setup({ analyze: value => calls.push(value) });
  ui.render({ ...base, phase: 'ready', preview: undefined });
  const mode = control('分析连接'); mode.value = 'custom'; mode.dispatch('change');
  control('API 地址').value = 'https://example.invalid/v1'; control('模型名称').value = 'custom-model'; control('API 密钥').value = 'test-secret';
  button('分析并生成迁移预览').click(); await tick();
  assert.deepEqual(calls[0], { mode: 'custom', url: 'https://example.invalid/v1', key: 'test-secret', model: 'custom-model', structured: false, requirements: '' });
  mode.value = 'current'; mode.dispatch('change'); button('分析并生成迁移预览').click(); await tick();
  assert.deepEqual(calls[1], { mode: 'current', url: '', key: '', model: '', structured: false, requirements: '' });
  ui.open(); ui.close(); assert.equal(control('API 密钥').value, ''); ui.destroy();
});

test('write requires explicit confirmation, partial ACK and resets when target replacement changes', async () => {
  const calls = [], { ui, button, checkbox } = setup({ apply: value => calls.push(value) });
  const partial = { ...base, schema: { status: 'partial', warnings: ['有自定义转换'] } };
  ui.render(partial); const apply = button('备份并应用到目标聊天');
  assert.equal(apply.disabled, true);
  const confirmed = checkbox('我已核对目标聊天'), acknowledged = checkbox('我已了解');
  confirmed.checked = true; confirmed.dispatch('change'); assert.equal(apply.disabled, true);
  acknowledged.checked = true; acknowledged.dispatch('change'); assert.equal(apply.disabled, false);
  apply.click(); await tick(); assert.deepEqual(calls, [{ ackPartial: true, confirmed: true }]);
  ui.render({ ...partial, preview: { ...base.preview, targetChanges: [{ path: ['进度'], kind: 'remove', before: '当前剧情' }] } });
  assert.equal(confirmed.checked, false); assert.equal(acknowledged.checked, false); assert.equal(apply.disabled, true);
  ui.render({ ...base, schema: { status: 'failed' } }); confirmed.checked = true; confirmed.dispatch('change'); assert.equal(apply.disabled, true); ui.destroy();
});

test('ordinary rerenders preserve editor draft and focus; failed actions keep the draft unapplied', async () => {
  const { ui, control, button, shadow } = setup({ editTargetScript: () => false });
  ui.render(base); const editor = control('新版结构源码'); editor.value = 'const draft = true;'; editor.focus(); editor.dispatch('input');
  ui.render({ ...base, message: 'progress' }); assert.equal(editor.value, 'const draft = true;'); assert.equal(shadow.activeElement, editor);
  button('使用这份新版源码').click(); await tick(); assert.equal(button('重新分析迁移方案').disabled, true); ui.destroy();
});

test('capture source replacement is explicit and backup download remains available when restore is blocked', async () => {
  const captures = [], downloads = [], { ui, button, control } = setup({ capture: value => captures.push(value), exportBackup: id => downloads.push(id) });
  ui.render({ ...base, backups: [{ id: 'backup-1', label: '其他聊天', createdAt: '2026-10-08', restorable: false }] });
  control('读取楼层').value = '4'; control('旧存档读取楼层').value = '4'; button('读取新版目标').click(); button('提取当前聊天').click(); await tick();
  assert.deepEqual(captures, [{ floor: 4, replaceSource: false }, { floor: 4, replaceSource: true }]);
  assert.equal(button('恢复此备份').disabled, true); assert.equal(button('下载备份').disabled, false);
  button('下载备份').click(); await tick(); assert.deepEqual(downloads, ['backup-1']); ui.destroy();
});

test('untrusted preview names remain text and target replacement details are distinct', () => {
  const { ui, shadow } = setup();
  ui.render({ ...base, preview: { ...base.preview, summary: '<img src=x onerror=alert(1)>', targetChanges: [{ path: ['现有进度'], kind: 'remove', before: '保留我' }] } });
  assert.ok(shadow.textContent.includes('<img src=x onerror=alert(1)>')); assert.equal(shadow.querySelectorAll('img').length, 0);
  assert.ok(shadow.textContent.includes('目标聊天将被替换的内容 · 1 项')); assert.ok(shadow.textContent.includes('保留我')); ui.destroy();
});

test('replacing the old save clears only its optional old-schema draft', () => {
  const { ui, control, button } = setup();
  ui.render({ ...base, source: { ...base.source, revision: 1 } });
  const oldEditor = control('旧版结构源码'); oldEditor.value = 'const OldSchema = previousCard;'; oldEditor.dispatch('input');
  ui.render({ ...base, source: { ...base.source, revision: 1 } }); assert.equal(oldEditor.value, 'const OldSchema = previousCard;');
  ui.render({ ...base, source: { ...base.source, revision: 2 } }); assert.equal(oldEditor.value, ''); assert.equal(button('重新分析迁移方案').disabled, false);
  oldEditor.value = 'manual optional draft'; oldEditor.dispatch('input'); ui.render(base); assert.equal(oldEditor.value, 'manual optional draft'); ui.destroy();
});

test('workspace navigation is read-only and keeps editor drafts plus each page scroll', () => {
  let calls = 0;
  const { ui, shadow, control } = setup({ analyze: () => calls++, capture: () => calls++, apply: () => calls++ });
  ui.render({ ...base, phase: 'ready', preview: undefined });
  const nav = key => shadow.querySelectorAll('button').find(n => n.dataset.destination === key);
  const panel = key => shadow.querySelectorAll('section').find(n => n.dataset.panel === key);
  const scroll = shadow.querySelectorAll('main')[0];
  control('新版结构源码').value = '未应用的草稿'; control('新版结构源码').dispatch('input');
  scroll.scrollTop = 170; nav('analysis').click(); assert.equal(panel('prepare').hidden, true); assert.equal(panel('analysis').hidden, false);
  assert.equal(nav('result').disabled, true); scroll.scrollTop = 25;
  nav('prepare').click(); assert.equal(scroll.scrollTop, 170); assert.equal(control('新版结构源码').value, '未应用的草稿');
  nav('analysis').click(); assert.equal(scroll.scrollTop, 25); assert.equal(calls, 0); ui.destroy();
});

test('completed analysis opens result page, while invalidated preview leaves no blank result screen', () => {
  const { ui, shadow } = setup(); ui.open();
  ui.render({ ...base, phase: 'analyzing', busy: true, preview: undefined });
  ui.render(base);
  const panels = shadow.querySelectorAll('section').filter(n => n.dataset.panel);
  assert.equal(panels.find(n => !n.hidden).dataset.panel, 'result');
  assert.equal(shadow.activeElement.id, 'mzm-result-heading');
  ui.render({ ...base, phase: 'ready', preview: undefined });
  assert.equal(panels.find(n => !n.hidden).dataset.panel, 'prepare'); ui.destroy();
});

test('rule selection preserves selected entries beyond the first page and renders untrusted names as text', async () => {
  const calls = [], { ui, shadow, checkbox } = setup({ selectRules: ids => calls.push(ids) });
  const entries = Array.from({ length: 42 }, (_, index) => ({ id: 'rule-' + index, uid: index, worldbook: '世界书', name: index === 0 ? '<img src=x onerror=bad()>规则' : '规则' + index, content: '原文', enabled: true, candidate: true }));
  ui.render({ ...base, worldbookEntries: entries, selectedRuleIds: ['rule-41'] });
  const item = checkbox('<img src=x onerror=bad()>规则'); item.checked = true; item.dispatch('change'); await tick();
  assert.deepEqual(calls[0], ['rule-41', 'rule-0']); assert.equal(shadow.querySelectorAll('img').length, 0); ui.destroy();
});

test('unapplied rule draft prevents analysis and application until explicitly applied', async () => {
  const calls = [], { ui, button, control, checkbox } = setup({ editRules: text => calls.push(text) }); ui.render(base);
  const draft = control('新版变量更新规则'); draft.value = '迁移不得按每日规则重置进度'; draft.dispatch('input');
  checkbox('我已核对目标聊天').checked = true; checkbox('我已核对目标聊天').dispatch('change');
  assert.equal(button('备份并应用到目标聊天').disabled, true); assert.equal(button('重新分析迁移方案').disabled, true);
  button('使用这份规则').click(); await tick(); assert.deepEqual(calls, ['迁移不得按每日规则重置进度']); ui.destroy();
});

test('worldbook search exposes unbound books and selecting a chat snapshot calls the dedicated action', async () => {
  const opened = [], selected = [], { ui, control } = setup({ openWorldbook: name => opened.push(name), selectChatSource: id => selected.push(id) });
  ui.render({ ...base, worldbooks: [{ name: '主书', scopes: ['角色主世界书'] }, { name: '未绑定书', scopes: [] }], chatImport: { label: '旧聊天', selectedId: '3:0', candidates: [{ id: '3:0', label: '第 3 楼', fieldCount: 1 }, { id: '1:1', label: '第 1 楼', fieldCount: 2 }] } });
  control('查找世界书').value = '未绑定'; control('查找世界书').dispatch('input');
  assert.ok(control('选择世界书').textContent.includes('未绑定书')); assert.equal(control('选择世界书').textContent.includes('主书'), false);
  control('选择世界书').value = '未绑定书'; control('选择世界书').dispatch('change');
  control('选择旧聊天存档').value = '1:1'; control('选择旧聊天存档').dispatch('change'); await tick();
  assert.deepEqual(opened, ['未绑定书']); assert.deepEqual(selected, ['1:1']); ui.destroy();
});

test('requirements and feedback are distinct, current connection excludes custom secrets, drafts block stale writes', async () => {
  const calls = [], { ui, control, button, checkbox } = setup({ analyze: config => calls.push(['analyze', config]), revise: config => calls.push(['revise', config]) });
  ui.render({ ...base, analysisRequirements: '' });
  control('迁移要求（可选）').value = '保留事实'; control('迁移要求（可选）').dispatch('input');
  checkbox('我已核对目标聊天').checked = true; checkbox('我已核对目标聊天').dispatch('change');
  assert.equal(button('备份并应用到目标聊天').disabled, true);
  button('重新分析迁移方案').click(); await tick(); assert.equal(calls[0][1].requirements, '保留事实');
  ui.render({ ...base, analysisRequirements: '保留事实' });
  control('API 密钥').value = 'do-not-send'; control('补充修改意见').value = '金币不转换'; control('补充修改意见').dispatch('input');
  assert.equal(button('备份并应用到目标聊天').disabled, true); button('按反馈重新调整方案').click(); await tick();
  assert.equal(calls[1][1].instructions, '金币不转换'); assert.equal(calls[1][1].key, ''); ui.destroy();
});

test('variable drafts stay intact, block stale writes and exports, and failed edits remain editable', async () => {
  const calls = [], { ui, button, control, checkbox } = setup({ editResult: text => { calls.push(text); return false; } });
  const current = { ...base, resultData: { 金币: 2 }, sourceData: { 金币: 1 } };
  ui.render(current);
  const editor = control('编辑迁移结果（JSON）'); editor.value = '{"金币":17}'; editor.dispatch('input');
  checkbox('我已核对目标聊天').checked = true; checkbox('我已核对目标聊天').dispatch('change');
  assert.equal(button('备份并应用到目标聊天').disabled, true); assert.equal(button('下载新版变量存档').disabled, true);
  ui.render({ ...current, message: '其他状态刷新' }); assert.equal(editor.value, '{"金币":17}');
  button('检查并更新结果').click(); await tick(); assert.deepEqual(calls, ['{"金币":17}']);
  assert.equal(editor.value, '{"金币":17}'); assert.equal(button('备份并应用到目标聊天').disabled, true);
  const old = control('查看 / 编辑旧变量（JSON）'); old.value = '{"金币":9}'; old.dispatch('input');
  assert.equal(button('下载提取的变量').disabled, true); assert.equal(button('重新分析迁移方案').disabled, true); ui.destroy();
});

test('清空按钮在分析时可用、保存时禁用；清空后所有输入回到空白', async () => {
  const calls = [], { ui, button, control, shadow } = setup({ clear: () => calls.push('clear') });
  ui.render({ ...base, resultData: { 金币: 2 }, sourceData: { 金币: 1 } });
  for (const name of ['新版结构源码', '旧版结构源码', '新版变量更新规则', '迁移要求（可选）', '补充修改意见', 'API 密钥', '查看 / 编辑旧变量（JSON）', '编辑迁移结果（JSON）']) { control(name).value = '草稿'; control(name).dispatch('input'); }
  ui.render({ ...base, busy: true, phase: 'analyzing' }); assert.equal(button('清空内容').disabled, false);
  button('清空内容').click(); await tick(); assert.deepEqual(calls, ['clear']);
  ui.render({ phase: 'idle', resetRevision: 1, backups: [] });
  for (const name of ['新版结构源码', '旧版结构源码', '新版变量更新规则', '迁移要求（可选）', '补充修改意见', 'API 密钥']) assert.equal(control(name).value, '');
  assert.equal(control('读取楼层').value, '-1'); assert.equal(control('旧存档读取楼层').value, '-1');
  assert.equal(shadow.querySelectorAll('section').find(n => n.dataset.panel === 'prepare').hidden, false);
  ui.render({ ...base, busy: true, phase: 'preview' }); assert.equal(button('清空内容').disabled, true); ui.destroy();
});
