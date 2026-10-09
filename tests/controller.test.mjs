import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/main.mjs';
import { BACKUP_KEY } from '../src/host.mjs';

const copy = value => structuredClone(value);
const schema = expression => `const Schema = ${expression}; registerMvuSchema(Schema);`;
const plan = (operations = [], extra = {}) => ({ version: 1, summary: '旧存档适配新版', operations, questions: [], warnings: [], ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const step = () => new Promise(resolve => setImmediate(resolve));

function fixture({ content = schema('z.object({金币:z.number()})'), target = { 金币: 1 }, responses = [plan()] } = {}) {
  const memory = new Map(), requests = [], downloads = [], events = [], hooks = {}, views = [];
  const scripts = [{ type: 'script', value: { id: 'schema-v2', name: '变量结构', content, enabled: true } }];
  const worldbook = [{ uid: 0, name: '变量更新规则', enabled: true, content: '金币是当前持有金额，迁移时保留已游玩数值。' }];
  const before = { stat_data: copy(target), schema: 'placeholder', display_data: { label: '保留' }, private_state: false };
  const ctx = { characterId: 0, characters: [{ name: '新版测试卡', avatar: 'new.png' }], chatId: 'new-chat',
    chat: [{ name: '角色', is_user: false, is_system: false, mes: '正文', swipes: ['正文', '其他分支'], swipe_id: 0,
      variables: [copy(before), { stat_data: { 金币: 999 } }] }],
    async saveChat() { events.push('save'); await hooks.save?.(); },
  };
  const api = {
    getVariables({ type, message_id }) { assert.equal(type, 'message'); const row = ctx.chat[message_id]; return copy(row.variables[row.swipe_id]); },
    getChatMessages(message_id, options) { assert.equal(options.include_swipes, true); const row = ctx.chat[message_id]; return [{ message_id, name: row.name, role: 'assistant', message: row.mes, swipes: copy(row.swipes), swipe_id: row.swipe_id }]; },
    getScriptTrees(options) { assert.deepEqual(options, { type: 'character' }); return copy(scripts); },
    getTavernHelperVersion() { return '4.11.3-test'; },
    getCharWorldbookNames() { return { primary: '新版规则', additional: [] }; },
    getChatWorldbookName() { return null; },
    getWorldbookNames() { return ['新版规则']; },
    getWorldbook(name) { assert.equal(name, '新版规则'); return copy(worldbook); },
    generateRaw(options) { requests.push(options); const next = responses.shift(); return typeof next === 'function' ? next(options) : typeof next === 'string' ? next : JSON.stringify(next); },
    stopGenerationById(id) { events.push(`stop:${id}`); },
    replaceVariables(value, { type, message_id }) { assert.equal(type, 'message'); assert.ok(memory.get(BACKUP_KEY), '首次写入前必须落备份'); events.push('write'); ctx.chat[message_id].variables[ctx.chat[message_id].swipe_id] = copy(value); },
  };
  const storage = { getItem: key => memory.get(key) ?? null, setItem(key, value) { memory.set(key, value); } };
  const controller = createController({ api, context: () => ctx, storage, fetcher() { throw new Error('离线测试不允许访问网络'); }, render: value => views.push(copy(value)), download: (name, value) => downloads.push({ name, value: copy(value) }) });
  const view = () => controller.state().view;
  const read = async source => { if (source) controller.actions.importSource(JSON.stringify(source)); await controller.actions.capture({ floor: 0 }); };
  const analyze = () => controller.actions.analyze({ mode: 'current', structured: true });
  const apply = options => controller.actions.apply({ confirmed: true, ackPartial: false, ...options });
const state = () => copy(ctx.chat[0].variables[0]);
  return { controller, actions: controller.actions, view, read, analyze, apply, state, ctx, scripts, worldbook, api, requests, responses, downloads, events, hooks, memory, before, views };
}

test('忙碌拦截后原预览可重试，结束生成后写入成功', async () => {
  const f = fixture(); await f.read({ 金币: 20 }); await f.analyze();
  f.ctx.migrationObservedGeneration = true; await f.apply();
  assert.match(f.view().error, /正在生成/); assert.equal(f.view().canApply, true); assert.equal(f.events.includes('write'), false);
  f.ctx.migrationObservedGeneration = false; await f.apply();
  assert.equal(f.view().phase, 'saved'); assert.equal(f.state().stat_data.金币, 20);
});

test('提取变量可以单独导出和编辑，不读取目标、不调用模型、不改聊天', () => {
  const f = fixture();
  f.actions.importSource(JSON.stringify([{ user_name: '玩家', character_name: '角色', chat_metadata: {} }, { mes: '不进入变量文件的正文', is_user: false, swipe_id: 1, variables: [{ stat_data: { 金币: 3 } }, { stat_data: { 金币: 5, 零值: 0, 空值: null, 开关: false } }] }]), 'old.jsonl');
  f.actions.exportVariables(); assert.equal(f.downloads[0].name, 'mvu-old-variables.json');
  assert.deepEqual(f.downloads[0].value, { stat_data: { 金币: 5, 零值: 0, 空值: null, 开关: false } });
  f.actions.editSource('{"金币":8,"零值":0,"开关":false}'); f.actions.exportVariables();
  assert.equal(f.downloads.at(-1).value.stat_data.金币, 8);
  assert.equal(f.controller.state().snapshot, null); assert.equal(f.requests.length, 0); assert.deepEqual(f.state(), f.before);
  for (const text of ['{坏的json}', '[]', '{"金币":1,"金币":2}', '{"__proto__":{}}']) assert.throws(() => f.actions.editSource(text));
  assert.equal(f.controller.state().source.statData.金币, 8);
  f.actions.selectChatSource('0:0'); assert.equal(f.controller.state().source.statData.金币, 3);
});

test('旧变量编辑撤销旧预览，保留旧结构；结果编辑重新校验、导出和备份', async () => {
  const f = fixture({ content: schema('z.object({金币:z.number().min(0)})') });
  await f.read({ format: 'mvu-zod-migration', kind: 'source', statData: { 金币: 8 }, scripts: [{ id: 'old', name: '旧结构', content: 'const Schema=z.object({金币:z.number()});', enabled: true }] });
  await f.analyze(); f.actions.editSource('{"金币":9}');
  assert.equal(f.view().preview, undefined); assert.equal(f.controller.state().source.scripts[0].id, 'old');
  f.responses.push(plan()); await f.analyze();
  assert.equal(JSON.parse(f.requests.at(-1).ordered_prompts[1].content).old_stat_data.金币, 9);
  f.actions.editResult('{"金币":-1}'); assert.equal(f.view().schema.status, 'failed'); assert.equal(f.view().canApply, false);
  await assert.rejects(f.apply(), /尚不能写入/); assert.equal(f.events.includes('write'), false);
  assert.throws(() => f.actions.editResult('[]'), /JSON 对象/);
  f.actions.editResult('{"金币":17}'); assert.equal(f.view().canApply, true); assert.equal(f.view().preview.manualEdited, true);
  assert.deepEqual(f.view().preview.changes.map(c => [c.before, c.after]), [[9, 17]]);
  f.actions.exportResult(); assert.equal(f.downloads.at(-1).value.statData.金币, 17);
  f.actions.exportReport(); assert.equal(f.downloads.at(-1).value.playerEditedResult.金币, 17);
  await f.apply(); assert.equal(f.state().stat_data.金币, 17); assert.equal(f.state().private_state, false);
  const backup = JSON.parse(f.memory.get(BACKUP_KEY))[0]; assert.equal(backup.beforeVariables.stat_data.金币, 1); assert.equal(backup.metadata.manualEdited, true);
});

test('手动编辑不能绕过未答问题；后续 AI 反馈收到手动结果', async () => {
  const question = { id: 'amount', question: '确认金额', path: ['金币'], options: [{ label: '保留', value: 8 }, { label: '重置', value: 0 }] };
  const f = fixture({ responses: [plan([], { questions: [question] }), plan([{ op: 'set', path: ['金币'], value: 15, reason: '反馈' }])] });
  await f.read({ 金币: 8 }); await f.analyze();
  assert.throws(() => f.actions.editResult('{"金币":12}'), /待处理选择/);
  f.actions.answer('amount', 0); f.actions.editResult('{"金币":12}');
  await f.actions.revise({ mode: 'current', instructions: '加三枚金币' });
  const payload = JSON.parse(f.requests.at(-1).ordered_prompts[1].content);
  assert.equal(payload.old_stat_data.金币, 8); assert.equal(payload.player_review.player_edited_result.金币, 12);
  assert.equal(f.view().resultData.金币, 15); assert.equal(f.view().preview.manualEdited, false);
});
test('编辑结果超过差异上限时保留旧预览和旧待写数据，不出现半更新', async () => {
  const f = fixture({ content: schema('z.record(z.string(),z.number())') });
  await f.read({ 金币: 8 }); await f.analyze(); const prior = copy(f.view().preview);
  const oversized = Object.fromEntries(Array.from({ length: 10002 }, (_, index) => ['字段' + index, index]));
  assert.throws(() => f.actions.editResult(JSON.stringify(oversized)), /变化|10000|差异/);
  assert.deepEqual(f.view().preview, prior); assert.deepEqual(f.controller.state().trial.data, { 金币: 8 });
  f.actions.exportResult(); assert.deepEqual(f.downloads.at(-1).value.statData, { 金币: 8 });
});

test('导入新版变量无需旧文件或 AI，预览后备份替换当前楼层，保留其他变量', async () => {
  const f = fixture(); await f.read();
  await f.actions.importResult(JSON.stringify({ format: 'mvu-zod-migration', kind: 'result', version: 1, statData: { 金币: 77 }, rules: [{ content: '不采用文件规则' }] }), 'new-save.json');
  assert.equal(f.view().phase, 'preview'); assert.equal(f.view().canApply, true); assert.equal(f.requests.length, 0);
  assert.deepEqual(f.controller.state().source.statData, { 金币: 1 }); assert.equal(f.state().stat_data.金币, 1);
  assert.deepEqual(f.view().preview.changes.map(c => [c.before, c.after]), [[1, 77]]);
  await f.apply(); assert.equal(f.state().stat_data.金币, 77); assert.equal(f.state().private_state, false);
  assert.equal(JSON.parse(f.memory.get(BACKUP_KEY))[0].beforeVariables.stat_data.金币, 1);
});

test('新版导入受目标、结构与纯变量格式限制，不偷偷运行 AI 修复', async () => {
  const f = fixture();
  await assert.rejects(f.actions.importResult('{"stat_data":{"金币":4}}'), /读取/);
  await f.read({ 金币: 9 }); await f.actions.importResult('{"stat_data":{"金币":"错误类型"}}');
  assert.equal(f.view().schema.status, 'failed'); assert.equal(f.view().canApply, false);
  await assert.rejects(f.apply(), /尚不能写入/); assert.equal(f.requests.length, 0);
  await assert.rejects(f.actions.importResult('[{"mes":"正文","is_user":false}]'));
  await f.actions.importResult('{"金币":22}'); assert.equal(f.view().resultData.金币, 22);
  assert.equal(f.controller.state().source.statData.金币, 9, '已有旧来源不被新版文件覆盖');
  f.ctx.chat[0].variables[0].stat_data.金币 = 2;
  await f.apply(); assert.equal(f.state().stat_data.金币, 2); assert.equal(f.events.includes('write'), false);
});

test('清空结束本次资料与迟到请求，聊天和已有备份保留', async () => {
  const f = fixture(); await f.read(); await f.actions.importResult('{"金币":11}'); await f.apply();
  const savedState = f.state(), savedBackup = f.memory.get(BACKUP_KEY);
  f.actions.clear();
  assert.equal(f.view().phase, 'idle'); assert.equal(f.controller.state().source, null); assert.equal(f.controller.state().snapshot, null);
  assert.equal(f.view().resultData, undefined); assert.deepEqual(f.view().selectedRuleIds, []); assert.equal(f.view().backups.length, 1);
  assert.deepEqual(f.state(), savedState); assert.equal(f.memory.get(BACKUP_KEY), savedBackup);
  await f.read({ 金币: 12 }); const late = deferred(); f.responses[0] = () => late.promise;
  const pending = f.analyze(); await step(); f.actions.clear(); late.resolve(JSON.stringify(plan())); await pending;
  assert.equal(f.view().phase, 'idle'); assert.equal(f.view().preview, undefined); assert.equal(f.view().resetRevision, 2);
  assert.deepEqual(f.state(), savedState); assert.equal(f.memory.get(BACKUP_KEY), savedBackup);
});

test('实际保存进行时不能清空事务', async () => {
  const f = fixture(); await f.read(); await f.actions.importResult('{"金币":11}');
  const saving = deferred(); f.hooks.save = () => saving.promise;
  const pending = f.apply(); await step(); assert.throws(() => f.actions.clear(), /保存结束/);
  saving.resolve(); await pending; assert.equal(f.view().phase, 'saved'); assert.equal(f.state().stat_data.金币, 11);
});

test('导入旧存档后读取和刷新目标不会覆盖旧值；显式改用当前变量才替换', async () => {
  const f = fixture({ target: { 金币: 1 } });
  await f.read({ stat_data: { 金币: 120 } });
  assert.deepEqual(f.controller.state().source.statData, { 金币: 120 });
  assert.deepEqual(f.controller.state().snapshot.variables.stat_data, { 金币: 1 });
  await f.actions.refresh();
  f.actions.exportSource(); assert.deepEqual(f.downloads.at(-1).value.statData, { 金币: 120 });
  await f.actions.capture({ floor: 0, replaceSource: true });
  assert.deepEqual(f.controller.state().source.statData, { 金币: 1 });
});

test('导入聊天只选中的 MVU 进入请求，重新选楼层会撤销原预览', async () => {
  const f = fixture();
  f.actions.importSource([{ mes: '不能送出的正文', is_user: false, variables: [{ stat_data: { 金币: 10 } }] }, { mes: '不发送', is_user: false, variables: [{ stat_data: { 金币: 20 } }, { stat_data: { 金币: 30 } }], swipe_id: 1 }]);
  await f.actions.capture(); await f.analyze();
  assert.deepEqual(JSON.parse(f.requests[0].ordered_prompts[1].content).old_stat_data, { 金币: 30 });
  assert.equal(JSON.stringify(f.requests).includes('不能送出的正文'), false);
  f.actions.selectChatSource('0:0'); assert.equal(f.view().preview, undefined); assert.deepEqual(f.controller.state().source.statData, { 金币: 10 });
});

test('未绑定世界书按需读取且跨书保留选择，只发送所选条目并复核变化', async () => {
  const f = fixture(); const get = f.api.getWorldbook, calls = [], extra = [{ uid: 0, name: '补充含义', content: '指定补充', enabled: true }, { uid: 1, name: '无关内容', content: '不应发送', enabled: true }];
  f.api.getWorldbookNames = () => ['新版规则', '独立世界书'];
  f.api.getWorldbook = name => { calls.push(name); return name === '独立世界书' ? copy(extra) : get(name); };
  await f.read({ 金币: 120 }); assert.equal(calls.includes('独立世界书'), false);
  await f.actions.openWorldbook('独立世界书');
  assert.equal(f.view().selectedRuleIds.length, 1);
  f.actions.selectRules([...f.view().selectedRuleIds, f.view().worldbookEntries.find(r => r.worldbook === '独立世界书' && r.uid === 0).id]);
  await f.analyze(); const payload = JSON.parse(f.requests[0].ordered_prompts[1].content);
  assert.equal(payload.new_worldbook_variable_rules.length, 2); assert.equal(JSON.stringify(payload).includes('不应发送'), false);
  extra[0].content = '更改含义'; await f.apply(); assert.equal(f.view().phase, 'error'); assert.equal(f.events.includes('write'), false);
});

test('玩家要求与多轮反馈使用原始旧值，保留上一版方案和已选答案，重新校验后才可写入', async () => {
  const question = { id: '金币取值', question: '保留多少金币', path: ['金币'], options: [{ label: '原值', value: 120 }, { label: '折半', value: 60 }] };
  const f = fixture({ responses: [plan([], { questions: [question] }), plan([{ op: 'set', path: ['金币'], value: 110, reason: '按玩家反馈扣除 10' }]), plan()] });
  await f.read({ 金币: 120 }); await f.actions.analyze({ mode: 'current', requirements: '保留玩家确认的事实' }); f.actions.answer('金币取值', 0);
  await f.actions.revise({ mode: 'current', instructions: '修正为 110 金币' });
  let payload = JSON.parse(f.requests[1].ordered_prompts[1].content);
  assert.equal(payload.player_requirements, '保留玩家确认的事实'); assert.deepEqual(payload.player_review.previous_answers, { 金币取值: 0 });
  assert.deepEqual(payload.old_stat_data, { 金币: 120 }); assert.equal(f.controller.state().trial.data.金币, 110);
  assert.equal(f.events.includes('write'), false); assert.equal(f.view().schema.status, 'passed');
  await f.actions.revise({ mode: 'current', instructions: '撤销金币变化，保留原值' });
  payload = JSON.parse(f.requests[2].ordered_prompts[1].content);
  assert.deepEqual(payload.player_review.requests, ['修正为 110 金币', '撤销金币变化，保留原值']);
  assert.equal(payload.player_review.previous_plan.operations[0].value, 110); assert.equal(f.controller.state().trial.data.金币, 120);
  f.actions.exportReport(); assert.equal(f.downloads.at(-1).value.reviewRequests.length, 2);
});

test('反馈仍受结构与陈旧目标约束，失败可查看旧预览但不能直接写入', async () => {
  const f = fixture({ responses: [plan(), 'bad', 'still bad'] }); await f.read({ 金币: 120 }); await f.analyze();
  await f.actions.revise({ mode: 'current', instructions: '请重新考虑保留值' });
  assert.equal(f.view().phase, 'error'); assert.ok(f.view().preview); assert.equal(f.view().canApply, false);
  await assert.rejects(f.apply(), /不能写入/);
  const g = fixture({ responses: [plan(), plan()] }); await g.read({ 金币: 120 }); await g.analyze(); g.ctx.chatId = 'changed';
  await g.actions.revise({ mode: 'current', instructions: '保留' }); assert.equal(g.requests.length, 1); assert.equal(g.events.includes('write'), false);
});

test('取消反馈分析隔离迟到结果，保留旧预览以便重试，旧结果不能直接写入', async () => {
  const pending = deferred(), f = fixture({ responses: [plan(), () => pending.promise, plan()] });
  await f.read({ 金币: 120 }); await f.analyze();
  const running = f.actions.revise({ mode: 'current', instructions: '重新核对金币' }); while (f.requests.length < 2) await step();
  f.actions.cancel(); await running; assert.ok(f.view().preview); assert.equal(f.view().canApply, false);
  assert.equal(f.view().reviewCount, 0);
  await f.actions.revise({ mode: 'current', instructions: '再试一次，原值保留' });
  pending.resolve(JSON.stringify(plan([{ op: 'set', path: ['金币'], value: 0, reason: '迟到' }]))); await step();
  assert.equal(f.controller.state().trial.data.金币, 120); assert.equal(f.events.includes('write'), false);
  assert.deepEqual(JSON.parse(f.requests[2].ordered_prompts[1].content).player_review.requests, ['再试一次，原值保留']);
});

test('旧规则从导入、模型和来源导出中移除，结果只记录所选新版规则', async () => {
  const f = fixture(), oldRules = [{ id: 'old-rule', worldbook: '旧版', uid: 4, name: '旧变量规则', content: '金币原名余额', enabled: true }];
  await f.read({ format: 'mvu-zod-migration', kind: 'source', statData: { 金币: 120 }, rules: oldRules });
  await f.actions.refresh(); await f.analyze();
  const sent = JSON.parse(f.requests[0].ordered_prompts[1].content);
  assert.equal(Object.hasOwn(sent, 'old_worldbook_variable_rules'), false); assert.equal(sent.new_worldbook_variable_rules[0].worldbook, '新版规则');
  assert.equal(JSON.stringify(sent).includes('金币原名余额'), false);
  f.actions.exportSource(); assert.equal(Object.hasOwn(f.downloads.at(-1).value, 'rules'), false);
  f.actions.exportResult(); assert.equal(f.downloads.at(-1).value.rules[0].worldbook, '新版规则');
});

test('所选世界书规则在分析中或应用前变化，旧结果不写入', async () => {
  const pending = deferred(), f = fixture({ responses: [() => pending.promise] });
  await f.read({ 金币: 120 }); const running = f.analyze(); while (!f.requests.length) await step();
  f.worldbook[0].content += '新版含义变更'; pending.resolve(JSON.stringify(plan())); await running;
  assert.equal(f.view().phase, 'error'); assert.match(f.view().error, /世界书规则/); assert.equal(f.events.includes('write'), false);
  const g = fixture(); await g.read({ 金币: 120 }); await g.analyze(); g.worldbook[0].enabled = false; await g.apply();
  assert.equal(g.view().phase, 'error'); assert.match(g.view().error, /启用条件/); assert.equal(g.events.includes('write'), false);
});

test('旧卡单独捕获不读世界书；目标所选规则独立生效；缺规则接口需要部分检查确认', async () => {
  const f = fixture(); f.worldbook.push({ uid: 9, name: '字段含义', content: '玩家补选的资料', enabled: false });
  const getBook = f.api.getWorldbook; f.api.getWorldbook = () => { throw new Error('旧来源不能读取世界书'); };
  await f.actions.capture({ replaceSource: true }); f.actions.exportSource();
  assert.equal(Object.hasOwn(f.downloads.at(-1).value, 'rules'), false); assert.equal(f.controller.state().snapshot, null);
  f.api.getWorldbook = getBook;
  await f.read(); f.actions.selectRules([f.view().worldbookEntries.find(r => r.uid === 9).id]);
  await f.analyze(); assert.equal(JSON.parse(f.requests[0].ordered_prompts[1].content).new_worldbook_variable_rules[0].uid, 9); assert.equal(f.view().schema.status, 'partial');
  const g = fixture(); delete g.api.getWorldbook; await g.read({ 金币: 120 }); await g.analyze();
  assert.equal(g.view().schema.status, 'partial'); assert.match(g.view().schema.warnings.join(''), /世界书/);
  await assert.rejects(g.apply(), /未覆盖/); assert.equal(g.events.includes('write'), false);
});

test('最终差异包括结构补默认值与类型转换，并单独显示目标数据会怎样改变', async () => {
  const f = fixture({ content: schema('z.object({金币:z.coerce.number(),任务:z.array(z.string()).default([])})'), target: { 金币: 1, 目标独有: '要明确显示被移除' } });
  await f.read({ 金币: '120' }); await f.analyze();
  assert.equal(f.view().schema.status, 'passed'); assert.equal(f.view().phase, 'preview');
  assert.deepEqual(f.controller.state().trial.data, { 金币: 120, 任务: [] });
  assert.deepEqual(f.view().preview.changes.map(item => [item.path.join('.'), item.kind]).sort(), [['金币', 'change'], ['任务', 'add']].sort());
  assert.ok(f.view().preview.targetChanges.some(item => item.path.join('.') === '目标独有' && item.kind === 'remove'));
  assert.equal(f.view().preview.targetChanges.find(item => item.path.join('.') === '金币').before, 1);
  assert.deepEqual(f.controller.state().source.statData, { 金币: '120' });
  assert.equal(f.events.includes('write'), false);
});

test('必答问题阻断应用与结果导出，选择后重新计算可预览的结果', async () => {
  const questions = [{ id: 'stage', question: '选择关系阶段', path: ['关系'], options: [{ label: '熟悉', value: '熟悉' }, { label: '朋友', value: '朋友' }] }];
  const f = fixture({ content: schema("z.object({关系:z.enum(['熟悉','朋友'])})"), target: { 关系: '熟悉' }, responses: [plan([], { questions })] });
  await f.read({ 关系: '旧选项' }); await f.analyze();
  assert.equal(f.view().canApply, false); assert.equal(f.view().preview.unresolved.length, 1);
  await assert.rejects(f.apply(), /不能写入/); assert.throws(() => f.actions.exportResult(), /待确认项/);
  f.actions.answer('stage', 1);
  assert.equal(f.view().canApply, true); assert.equal(f.view().schema.status, 'passed');
  assert.deepEqual(f.controller.state().trial.data, { 关系: '朋友' });
  assert.equal(f.view().preview.changes[0].before, '旧选项'); assert.equal(f.view().preview.changes[0].after, '朋友');
});

test('部分检查必须单独确认；已知结构错误即使确认也不能写入', async () => {
  const content = schema('z.object({金币:z.number().max(100),名字:z.string().transform(v=>v.trim())})');
  const partial = fixture({ content }); await partial.read({ 金币: 12, 名字: ' A ' }); await partial.analyze();
  assert.equal(partial.view().schema.status, 'partial');
  await assert.rejects(partial.apply(), /结构检查范围/); assert.equal(partial.events.includes('write'), false);
  await partial.apply({ ackPartial: true }); assert.equal(partial.view().phase, 'saved');
  const failed = fixture({ content, responses: [plan(), plan()] });
  await failed.read({ 金币: 101, 名字: ' A ' }); await failed.analyze();
  assert.equal(failed.view().schema.status, 'failed'); assert.equal(failed.requests.length, 2);
  await assert.rejects(failed.apply({ ackPartial: true }), /不能写入/); assert.equal(failed.events.includes('write'), false);
});

test('草案格式错误或已知结构失败各只自动修正一次，第二次携带反馈', async () => {
  for (const first of ['not json', plan([{ op: 'set', path: ['金币'], value: '错误类型', reason: '错误草案' }])]) {
    const corrected = plan([{ op: 'set', path: ['金币'], value: 120, reason: '保留旧数值' }]);
    const f = fixture({ responses: [first, corrected] }); await f.read({ 金币: 120 }); await f.analyze();
    assert.equal(f.requests.length, 2); assert.equal(f.view().schema.status, 'passed');
    assert.match(f.requests[1].ordered_prompts[1].content, /feedback|previousResponse|previousPlan/);
    assert.deepEqual(f.controller.state().trial.data, { 金币: 120 });
    assert.equal(f.events.includes('write'), false);
  }
});

test('分析过程中或预览后修改目标结构脚本，旧草案都不能写入', async () => {
  const pending = deferred(), f = fixture({ responses: [() => pending.promise] });
  await f.read({ 金币: 120 }); const running = f.analyze();
  while (!f.requests.length) await step();
  f.scripts[0].value.content = schema('z.object({金币:z.number().max(10)})');
  pending.resolve(JSON.stringify(plan())); await running;
  assert.equal(f.view().phase, 'error'); assert.match(f.view().error, /结构脚本已变化/);
  assert.equal(f.view().preview, undefined); assert.equal(f.events.includes('write'), false);
  const after = fixture(); await after.read({ 金币: 120 }); await after.analyze();
  after.scripts[0].value.content += '\n// 编辑'; await after.apply();
  assert.equal(after.view().phase, 'error'); assert.match(after.view().error, /结构脚本已变化/);
  assert.equal(after.events.includes('write'), false);
});

test('取消后迟到的模型结果无效，新分析可以独立完成', async () => {
  const pending = deferred(), f = fixture({ responses: [() => pending.promise, plan()] });
  await f.read({ 金币: 120 }); const first = f.analyze(); while (!f.requests.length) await step();
  f.actions.cancel(); await first; assert.equal(f.view().phase, 'ready'); assert.equal(f.view().preview, undefined);
  assert.ok(f.events.some(event => event.startsWith('stop:')));
  await f.analyze(); const expected = copy(f.view().preview);
  pending.resolve(JSON.stringify(plan([{ op: 'set', path: ['金币'], value: 0, reason: '迟到' }]))); await step();
  assert.deepEqual(f.view().preview, expected); assert.equal(f.controller.state().trial.data.金币, 120);
  assert.equal(f.events.includes('write'), false);
});

test('保存完成前始终是未应用结果；落盘读回后才导出 applied=true', async () => {
  const pending = deferred(), f = fixture(); await f.read({ 金币: 120 }); await f.analyze();
  f.actions.exportResult(); assert.equal(f.downloads.at(-1).value.applied, false);
  f.hooks.save = () => pending.promise; const saving = f.apply();
  while (!f.events.includes('save')) await step();
  assert.equal(f.view().busy, true); assert.notEqual(f.view().phase, 'saved');
  f.actions.exportResult(); assert.equal(f.downloads.at(-1).value.applied, false);
  assert.equal(JSON.parse(f.memory.get(BACKUP_KEY))[0].status, 'prepared');
  pending.resolve(); await saving;
  assert.equal(f.view().phase, 'saved'); assert.match(f.view().message, /读回核对/);
  f.actions.exportResult(); assert.equal(f.downloads.at(-1).value.applied, true);
  assert.deepEqual(f.state(), { ...f.before, stat_data: { 金币: 120 } });
  assert.equal(f.view().backups.length, 1); assert.equal(f.view().backups[0].restorable, true);
  await f.actions.restore(f.view().backups[0].id);
  assert.deepEqual(f.state(), f.before); assert.match(f.view().message, /恢复/);
  assert.throws(() => f.actions.exportResult(), /待确认项/);
});

test('保存失败后回滚，结果仍标未应用，不误报迁移已保存', async () => {
  const f = fixture(); await f.read({ 金币: 120 }); await f.analyze();
  let count = 0; f.hooks.save = () => { if (++count === 1) throw new Error('测试保存失败'); };
  await f.apply(); assert.equal(f.view().phase, 'error'); assert.match(f.view().message, /保存未完成/);
  assert.deepEqual(f.state(), f.before); f.actions.exportResult(); assert.equal(f.downloads.at(-1).value.applied, false);
  assert.equal(JSON.parse(f.memory.get(BACKUP_KEY))[0].status, 'rolled-back');
});

test('迁移后续玩变更不能直接恢复，切聊天会撤销预览并保留导入旧值', async () => {
  const f = fixture(); await f.read({ 金币: 120 }); await f.analyze(); await f.apply();
  const id = f.view().backups[0].id; f.ctx.chat[0].variables[0].stat_data.金币 = 121;
  await f.actions.restore(id); assert.equal(f.view().phase, 'error'); assert.match(f.view().error, /又有新变化/);
  assert.equal(f.state().stat_data.金币, 121);
  await f.actions.refresh(); f.responses.push(plan()); await f.analyze();
  f.ctx.chatId = 'another-chat'; f.controller.poll();
  assert.equal(f.view().phase, 'idle'); assert.equal(f.view().preview, undefined); assert.equal(f.view().canApply, false);
  assert.deepEqual(f.controller.state().source.statData, { 金币: 120 });
  await assert.rejects(f.apply(), /不能写入/);
});
