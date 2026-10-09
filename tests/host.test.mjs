import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHost, makeModelClient, observeGeneration, BACKUP_KEY, PLAN_RESPONSE_SCHEMA } from '../src/host.mjs';
import { EventEmitter } from 'node:events';
import { cloneJson, fingerprint } from '../src/core.mjs';

function fixture({ before = { stat_data: { 金币: 12 }, schema: 'placeholder', display_data: { 金币: '12枚' }, plugin_data: { keep: false } } } = {}) {
  const events = [], memory = new Map(), hooks = {};
  const ctx = {
    characterId: 0, characters: [{ name: '测试角色', avatar: 'test.png' }], chatId: '测试聊天',
    chat: [{ name: '测试角色', is_user: false, is_system: false, mes: '第一分支', swipe_id: 0, swipes: ['第一分支', '第二分支'], variables: [cloneJson(before), { stat_data: { 金币: 99 }, other: 'branch-two' }] }],
    async saveChat() { events.push('save'); await hooks.save?.(); },
  };
  const storage = {
    getItem(key) { return memory.get(key) ?? null; },
    setItem(key, value) { events.push('backup:' + JSON.parse(value).at(-1).status); hooks.persist?.(key, value); memory.set(key, value); },
  };
  const api = {
    getChatMessages(floor, options) {
      assert.equal(options.include_swipes, true); events.push('read-message');
      const row = ctx.chat[floor];
      const result = [{ message_id: floor, name: row.name, role: row.is_user ? 'user' : 'assistant', message: row.mes, swipe_id: row.swipe_id, swipes: cloneJson(row.swipes) }];
      hooks.message?.(); return result;
    },
    getVariables({ type, message_id: floor }) {
      assert.equal(type, 'message'); events.push('read-vars');
      const row = ctx.chat[floor], result = cloneJson(row.variables[row.swipe_id ?? 0]);
      hooks.variables?.(); return result;
    },
    replaceVariables(value, { type, message_id: floor }) {
      assert.equal(type, 'message'); events.push('write');
      const prepared = JSON.parse(memory.get(BACKUP_KEY) || '[]');
      assert.ok(prepared.length, 'write 前必须已有备份');
      hooks.beforeWrite?.(value);
      const row = ctx.chat[floor]; row.variables[row.swipe_id ?? 0] = cloneJson(value);
      hooks.afterWrite?.(value);
    },
  };
  const host = makeHost({ api, context: () => ctx, storage, now: () => '2026-10-08T00:00:00.000Z' });
  const state = () => cloneJson(ctx.chat[0].variables[ctx.chat[0].swipe_id ?? 0]);
  const swipe = index => { ctx.chat[0].swipe_id = index; ctx.chat[0].mes = ctx.chat[0].swipes[index]; };
  return { host, api, ctx, storage, events, memory, hooks, state, swipe, before: cloneJson(before) };
}

test('下载备份重新导入只加入列表，匹配目标后可恢复', async () => {
  const original = fixture();
  const result = await original.host.commit({ snapshot: await original.host.read(0), statData: { 金币: 30 } });
  const another = fixture({ before: result.record.afterVariables });
  another.host.importBackup(JSON.stringify(result.record));
  assert.equal(another.events.filter(e => e === 'write').length, 0);
  assert.equal(another.host.backups().length, 1);
  await another.host.restore(result.record.id);
  assert.deepEqual(another.state(), original.before);
});

test('损坏或同编号不同目标结果的备份不能覆盖已有备份', async () => {
  const f = fixture();
  const result = await f.host.commit({ snapshot: await f.host.read(0), statData: { 金币: 30 } });
  const bad = cloneJson(result.record); bad.beforeVariables.stat_data.金币 = 999;
  assert.throws(() => f.host.importBackup(JSON.stringify(bad)), /指纹/);
  const conflict = cloneJson(result.record); conflict.afterVariables.stat_data.金币 = 31; conflict.afterHash = fingerprint(conflict.afterVariables);
  assert.throws(() => f.host.importBackup(JSON.stringify(conflict)), /冲突/);
  assert.equal(f.host.backups()[0].afterHash, result.record.afterHash);
  assert.throws(() => f.host.importBackup(JSON.stringify({stat_data:{}})), /备份/);
});

test('真实宿主消息形状可读；读取消息到变量之间切分支被阻断', async () => {
  const f = fixture();
  const snapshot = await f.host.read(0);
  assert.equal(snapshot.target.floor, 0); assert.equal(snapshot.target.swipe, 0); assert.deepEqual(snapshot.variables, f.before);
  f.hooks.message = () => f.swipe(1);
  await assert.rejects(f.host.read(0), /读取期间|变化/);
});
test('变量读取期间修改同分支数值或切聊天，不能返回混合快照', async () => {
  const f = fixture();
  f.hooks.variables = () => { f.ctx.chat[0].variables[0].stat_data.金币 = 999; };
  await assert.rejects(f.host.read(0), /读取期间|变化/);
  delete f.hooks.variables; f.hooks.message = () => { f.ctx.chatId = '另一聊天'; };
  await assert.rejects(f.host.read(0), /聊天|改变/);
});
test('commit 先落备份、再写变量及保存，最后重新读取确认', async () => {
  const f = fixture(); const snapshot = await f.host.read(0); f.events.length = 0;
  const result = await f.host.commit({ snapshot, statData: { 资产: { 金币: 12 }, 新任务: [] }, metadata: { summary: '迁移' } });
  const prepared = f.events.indexOf('backup:prepared'), written = f.events.indexOf('write'), saved = f.events.indexOf('save'), reread = f.events.indexOf('read-vars', saved);
  assert.ok(prepared >= 0 && prepared < written && written < saved && saved < reread);
  assert.equal(result.record.status, 'committed'); assert.equal(f.host.backups().length, 1);
  assert.deepEqual(result.record.beforeVariables, f.before); assert.deepEqual(result.snapshot.variables, f.state());
  assert.equal(f.events.at(-1), 'backup:committed');
});
test('旧数据与目标不同，应用只替换 stat_data 并保留目标的其他变量', async () => {
  const f = fixture(); const snapshot = await f.host.read();
  const importedSourceResult = { 金币: 300, 玩家: { 名字: '旧卡玩家' } };
  await f.host.commit({ snapshot, statData: importedSourceResult });
  const after = f.state(); assert.deepEqual(after.stat_data, importedSourceResult);
  assert.equal(after.schema, f.before.schema); assert.deepEqual(after.display_data, f.before.display_data); assert.deepEqual(after.plugin_data, f.before.plugin_data);
  importedSourceResult.金币 = 0; assert.equal(f.state().stat_data.金币, 300);
});
test('已迁移的同状态再次应用没有写入也不创建重复备份', async () => {
  const f = fixture(); const saved = await f.host.commit({ snapshot: await f.host.read(), statData: { 金币: 13 } });
  f.events.length = 0;
  const repeated = await f.host.commit({ snapshot: saved.snapshot, statData: { 金币: 13 } });
  assert.equal(repeated.unchanged, true); assert.equal(f.host.backups().length, 1); assert.equal(f.events.includes('write'), false);
});
test('分析后聊天、分支、消息或变量改变均阻断旧结果', async () => {
  for (const change of [f => { f.ctx.chatId = '另一个聊天'; }, f => f.swipe(1), f => { f.ctx.chat[0].mes += '编辑'; }, f => { f.ctx.chat[0].variables[0].stat_data.金币++; }, f => { f.ctx.chat.push(cloneJson(f.ctx.chat[0])); }]) {
    const f = fixture(); const snapshot = await f.host.read(); change(f);
    await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /变化|改变/);
    assert.equal(f.events.includes('write'), false);
  }
});
test('生成中禁止写入，包括非流式生成观察状态', async () => {
  for (const busy of ['stream', 'observed']) {
    const f = fixture(); const snapshot = await f.host.read();
    if (busy === 'stream') f.ctx.streamingProcessor = { isFinished: false }; else f.ctx.migrationObservedGeneration = true;
    await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /正在生成/); assert.equal(f.events.includes('write'), false);
  }
});
test('提示词试运行不挂起迁移；当前状态可纠正缺少结束事件的残留', () => {
  const eventSource = new EventEmitter(), ctx = { eventSource, eventTypes: { GENERATION_STARTED: 'start', GENERATION_ENDED: 'end', GENERATION_STOPPED: 'stop', CHAT_CHANGED: 'chat' } };
  let probe;
  const monitor = observeGeneration({ context: () => ctx, getProbe: () => probe });
  eventSource.emit('start', 'normal', {}, true); assert.equal(monitor.busy(), false);
  eventSource.emit('start', 'normal', {}, false); assert.equal(monitor.busy(), true);
  eventSource.emit('stop', 'independent-helper-id'); assert.equal(monitor.busy(), true);
  probe = () => false; assert.equal(monitor.busy(), false);
  probe = () => true; assert.equal(monitor.busy(), true);
  eventSource.emit('end'); assert.equal(monitor.busy(), true, '旧结束事件不得盖过实际生成状态');
  probe = () => false; assert.equal(monitor.busy(), false);
  probe = undefined; eventSource.emit('start', 'normal', {}, false); eventSource.emit('stop'); assert.equal(monitor.busy(), false);
  eventSource.emit('start', 'normal', {}, false); eventSource.emit('chat'); assert.equal(monitor.busy(), false);
  monitor.destroy(); assert.equal(eventSource.eventNames().length, 0);
});
test('只有明确未结束的流式状态阻断，已停止或未知形状不会永远锁死', () => {
  const ctx = {}, monitor = observeGeneration({ context: () => ctx });
  for (const stream of [{}, { isFinished: true }, { isFinished: false, isStopped: true }, { isFinished: false, abortController: { signal: { aborted: true } } }]) { ctx.streamingProcessor = stream; assert.equal(monitor.busy(), false); }
  ctx.streamingProcessor = { isFinished: false, isStopped: false }; assert.equal(monitor.busy(), true);
  monitor.destroy();
});
test('备份过程中才开始生成也会在最终写入前阻断', async () => {
  const f = fixture(), snapshot = await f.host.read();
  f.hooks.persist = () => { f.ctx.migrationObservedGeneration = true; };
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /正在生成/);
  assert.equal(f.events.includes('write'), false); assert.deepEqual(f.state(), f.before);
  delete f.hooks.persist; f.ctx.migrationObservedGeneration = false;
  const result = await f.host.commit({ snapshot, statData: { 金币: 1 } }); assert.equal(result.record.status, 'committed');
});
test('备份配额失败不写入聊天', async () => {
  const f = fixture(); const snapshot = await f.host.read();
  f.hooks.persist = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /Quota/);
  assert.equal(f.events.includes('write'), false); assert.deepEqual(f.state(), f.before);
});
test('备份落盘后目标又更新，最终写入检查保留该更新', async () => {
  const f = fixture(); const snapshot = await f.host.read(); let changed = false;
  f.hooks.persist = () => { if (!changed) { changed = true; f.ctx.chat[0].variables[0].stat_data.金币 = 77; } };
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /变化/);
  assert.equal(f.state().stat_data.金币, 77); assert.equal(f.events.includes('write'), false); assert.equal(f.host.backups()[0].status, 'uncertain');
});
test('变量写入前失败不覆盖旧值，留下未应用备份状态', async () => {
  const f = fixture(); const snapshot = await f.host.read();
  f.hooks.beforeWrite = () => { throw new Error('write failed'); };
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /write failed/);
  assert.deepEqual(f.state(), f.before); assert.equal(f.host.backups()[0].status, 'not-applied');
});
test('写入接口未报错却没有写入，读回核验仍识别失败', async () => {
  const f = fixture(); const snapshot = await f.host.read();
  f.api.replaceVariables = () => { f.events.push('write-noop'); };
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /读回不一致/);
  assert.deepEqual(f.state(), f.before); assert.equal(f.host.backups()[0].status, 'not-applied');
});
test('写入已发生后接口失败，能在状态相符时回滚', async () => {
  const f = fixture(); const snapshot = await f.host.read(); let count = 0;
  f.hooks.afterWrite = () => { if (++count === 1) throw new Error('write acknowledgement failed'); };
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /acknowledgement failed/);
  assert.equal(count, 2); assert.deepEqual(f.state(), f.before); assert.equal(f.host.backups()[0].status, 'rolled-back');
});
test('保存失败回滚旧状态，再次保存并读回', async () => {
  const f = fixture(); const snapshot = await f.host.read(); let saves = 0;
  f.hooks.save = () => { if (++saves === 1) throw new Error('save failed'); };
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /save failed/);
  assert.equal(saves, 2); assert.deepEqual(f.state(), f.before); assert.equal(f.host.backups()[0].status, 'rolled-back');
});
test('保存失败时若另一脚本已更新，不用旧备份覆盖并发新值', async () => {
  const f = fixture(); const snapshot = await f.host.read();
  f.hooks.save = () => { f.ctx.chat[0].variables[0].stat_data.并发进度 = '已游玩'; throw new Error('save failed'); };
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 1 } }), /save failed/);
  assert.deepEqual(f.state().stat_data, { 金币: 1, 并发进度: '已游玩' });
  assert.equal(f.events.filter(e => e === 'write').length, 1); assert.equal(f.host.backups()[0].status, 'uncertain');
});
test('恢复只允许匹配迁移后指纹；恢复成功后再次恢复是无操作', async () => {
  const f = fixture(); const saved = await f.host.commit({ snapshot: await f.host.read(), statData: { 金币: 1 } });
  const migrated = f.state(); f.ctx.chat[0].variables[0].stat_data.金币 = 2;
  await assert.rejects(f.host.restore(saved.record.id), /又有新变化/); assert.equal(f.state().stat_data.金币, 2);
  f.ctx.chat[0].variables[0] = migrated;
  const restored = await f.host.restore(saved.record.id); assert.equal(restored.record.status, 'restored'); assert.deepEqual(f.state(), f.before);
  f.events.length = 0; assert.equal((await f.host.restore(saved.record.id)).unchanged, true); assert.equal(f.events.includes('write'), false);
});
test('恢复时切聊天或切分支同样阻断', async () => {
  for (const change of [f => { f.ctx.chatId = '另一聊天'; }, f => f.swipe(1)]) {
    const f = fixture(); const saved = await f.host.commit({ snapshot: await f.host.read(), statData: { 金币: 1 } }); change(f); f.events.length = 0;
    await assert.rejects(f.host.restore(saved.record.id), /改变|变化/); assert.equal(f.events.includes('write'), false);
  }
});
test('恢复前原生正文已编辑而 swipes 尚未同步，也不得覆盖', async () => {
  const f = fixture(); const saved = await f.host.commit({ snapshot: await f.host.read(), statData: { 金币: 1 } });
  f.ctx.chat[0].mes = '新的正文编辑'; f.events.length = 0;
  await assert.rejects(f.host.restore(saved.record.id), /改变|变化/); assert.equal(f.events.includes('write'), false);
});
test('并行提交不会产生第二次写入', async () => {
  const f = fixture(); const snapshot = await f.host.read();
  const first = f.host.commit({ snapshot, statData: { 金币: 1 } });
  await assert.rejects(f.host.commit({ snapshot, statData: { 金币: 2 } }), /正在保存/);
  await first; assert.equal(f.events.filter(e => e === 'write').length, 1);
});

const prompt = { system: '独立迁移指令', user: '{"source":{"金币":1}}' };
test('慢速模型超过原 120 秒后仍可返回，等待时间不触发停止', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve, finished = false; const stopped = [];
  const client = makeModelClient({ generateRaw: () => new Promise(r => { resolve = r; }), stopGenerationById: id => stopped.push(id) });
  const pending = client.request(prompt, { mode: 'current' }).then(value => { finished = true; return value; }, error => { finished = true; throw error; });
  t.mock.timers.tick(600000);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false); assert.deepEqual(stopped, []);
  resolve('慢速模型的完整方案'); assert.equal(await pending, '慢速模型的完整方案');
  t.mock.timers.reset();
});

test('旧取消信号不会取消新请求，旧模型迟到结果不生效', async () => {
  const resolvers = [], stopped = [];
  const client = makeModelClient({ generateRaw: () => new Promise(resolve => resolvers.push(resolve)), stopGenerationById: id => { stopped.push(id); return Promise.reject(new Error('stop unsupported')); } });
  const oldSignal = new AbortController();
  const first = client.request(prompt, { mode: 'current' }, oldSignal.signal);
  const firstRejected = assert.rejects(first, /取消/);
  client.cancel();
  const second = client.request(prompt, { mode: 'current' });
  oldSignal.abort(); resolvers[0]('旧结果'); resolvers[1]('新结果');
  await firstRejected; assert.equal(await second, '新结果'); assert.equal(stopped.length, 1);
});
test('API 使用独立提示词和空历史；结构化开关实际控制 json_schema', async () => {
  const requests = []; const client = makeModelClient({ generateRaw: options => { requests.push(options); return '{}'; } });
  await client.request(prompt, { mode: 'current', structured: true });
  await client.request(prompt, { mode: 'current', structured: false });
  const config = requests[0]; assert.equal(config.max_chat_history, 0); assert.equal(config.should_silence, true);
  assert.deepEqual(config.ordered_prompts, [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
  assert.deepEqual(config.overrides.chat_history, { prompts: [], with_depth_entries: false, author_note: '' });
  for (const key of ['world_info_before', 'world_info_after', 'char_description', 'char_personality', 'persona_description', 'scenario', 'dialogue_examples']) assert.equal(config.overrides[key], '');
  assert.deepEqual(config.json_schema.value, PLAN_RESPONSE_SCHEMA); assert.equal(Object.hasOwn(requests[1], 'json_schema'), false);
  assert.equal(Object.hasOwn(config, 'custom_api'), false);
});
test('自定义 API 仅把配置传给生成接口，错误中的密钥被隐藏', async () => {
  const key = 'test-secret-key'; let sent;
  const client = makeModelClient({ generateRaw: options => { sent = options; throw new Error(`API rejected ${key}, retry ${key}`); } });
  await assert.rejects(client.request(prompt, { mode: 'custom', url: 'https://api.example.test/v1', key, model: 'test-model' }), error => !error.message.includes(key) && error.message.includes('[已隐藏密钥]'));
  assert.deepEqual(sent.custom_api, { apiurl: 'https://api.example.test/v1', key, source: 'openai', model: 'test-model' });
  assert.equal(JSON.stringify(sent.ordered_prompts).includes(key), false);
});
test('取消或输入过大在调用模型前失败；已有请求时不重复发起', async () => {
  let calls = 0, resolve;
  const client = makeModelClient({ generateRaw: () => { calls++; return new Promise(r => { resolve = r; }); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.request(prompt, { mode: 'current' }, controller.signal), /取消/); assert.equal(calls, 0);
  await assert.rejects(client.request({ system: 'x', user: 'x'.repeat(300000) }, { mode: 'current' }), /30 万/); assert.equal(calls, 0);
  const pending = client.request(prompt, { mode: 'current' }); await assert.rejects(client.request(prompt, { mode: 'current' }), /已有分析/);
  resolve('{}'); await pending; assert.equal(calls, 1);
});
test('非 HTTPS 远程 API 和 URL 内凭据被拒，回环 HTTP 可使用', async () => {
  let calls = 0; const client = makeModelClient({ generateRaw: () => { calls++; return '{}'; } });
  for (const url of ['http://remote.example/v1', 'https://user:password@api.example/v1', 'file:///tmp/api']) {
    await assert.rejects(client.request(prompt, { mode: 'custom', url, model: 'model' }), /HTTPS|HTTP|密码/);
  }
  assert.equal(calls, 0); await client.request(prompt, { mode: 'custom', url: 'http://127.0.0.1:5000/v1', model: 'model' }); assert.equal(calls, 1);
});
