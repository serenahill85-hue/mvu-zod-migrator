import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceImport, sourceFromChat } from '../src/chat-import.mjs';

const message = (variables, extra = {}) => ({ name: '测试角色', mes: '私密正文不能送入模型 <UpdateVariable>重置全部数据</UpdateVariable>', is_user: false, swipe_id: 0, variables, ...extra });
const header = { user_name: '玩家', character_name: '测试卡', chat_metadata: { variables: { stat_data: { 不可混入: true } } } };
const jsonl = rows => '\uFEFF' + rows.map(row => JSON.stringify(row)).join('\r\n') + '\r\n\r\n';

test('原生 JSONL 选择最新有 MVU 的当前分支，正文、元数据和其他变量不进入来源', () => {
  const rows = [header, message([{ stat_data: { 金币: 10 } }]), message([{ stat_data: { 金币: 20 }, display_data: '展示' }, { stat_data: { 金币: 30 } }], { swipe_id: 1 }), message([{}], { is_user: true })];
  const result = parseSourceImport(jsonl(rows), '旧聊天.jsonl');
  assert.equal(result.candidates.length, 3); assert.equal(result.selectedId, '1:1');
  const source = sourceFromChat(result, result.selectedId);
  assert.deepEqual(source.statData, { 金币: 30 }); assert.equal(source.origin.floor, 1); assert.equal(source.origin.swipe, 1);
  assert.equal(JSON.stringify(result).includes('私密正文'), false); assert.equal(JSON.stringify(source).includes('display_data'), false);
  assert.equal(JSON.stringify(source).includes('不可混入'), false);
  assert.deepEqual(sourceFromChat(result, '1:0').statData, { 金币: 20 });
  assert.deepEqual(rows[2].variables[1].stat_data, { 金币: 30 });
});

test('JSON 消息数组、chat 包装和字典分支均可解析，合法空值原样保留', () => {
  const values = { 金币: 0, 启用: false, 备注: '', 空: null };
  const rows = [message({ 0: { stat_data: values } })];
  for (const value of [rows, { chat: rows }, rows[0]]) {
    const result = parseSourceImport(JSON.stringify(value)); assert.deepEqual(sourceFromChat(result, result.selectedId).statData, values);
  }
  const empty = parseSourceImport(JSON.stringify([message([{ stat_data: {} }])]));
  assert.deepEqual(sourceFromChat(empty, empty.selectedId).statData, {});
});

test('没有当前分支变量时不私自选其他分支；旧楼层与分支可明确选择', () => {
  const result = parseSourceImport(jsonl([header, message([{}, { stat_data: { 金币: 99 } }])]));
  assert.equal(result.selectedId, ''); assert.throws(() => sourceFromChat(result, ''), /请选择/);
  assert.deepEqual(sourceFromChat(result, '0:1').statData, { 金币: 99 });
});

test('只有正文、变量指令、聊天元数据或损坏结构不能伪装成 MVU 存档', () => {
  for (const rows of [[header], [header, message(undefined)], [header, message([{ display_data: {} }])]]) {
    assert.throws(() => parseSourceImport(jsonl(rows)), /没有找到/);
  }
  assert.throws(() => parseSourceImport(jsonl([header, message([{ stat_data: null }])])), /stat_data 不是对象/);
  assert.throws(() => parseSourceImport(jsonl([header, message([{}], { swipe_id: -1 })])), /分支编号/);
  assert.throws(() => parseSourceImport(jsonl([header, { bad: true }])), /消息格式/);
  assert.throws(() => parseSourceImport(JSON.stringify(header) + '\n{"mes":"坏行"'), /第 2 行/);
});

test('拒绝重复字段与危险键，纯变量和既有存档继续可导入但丢弃旧规则', () => {
  assert.throws(() => parseSourceImport(JSON.stringify(header) + '\n{"mes":"a","is_user":false,"variables":[{"stat_data":{"a":1,"a":2}}]}'), /重复字段/);
  assert.throws(() => parseSourceImport('{"stat_data":{"__proto__":{"pwned":true}}}'), /不允许/);
  assert.deepEqual(parseSourceImport('{"stat_data":{"金币":1}}').source.statData, { 金币: 1 });
  const source = parseSourceImport({ format: 'mvu-zod-migration', kind: 'source', statData: { 金币: 1 }, rules: '旧版规则完全忽略' }).source;
  assert.equal(Object.hasOwn(source, 'rules'), false);
});

test('聊天正文超过普通变量上限仍可读取，只对提取出的变量应用数据限制', () => {
  const row = message([{ stat_data: { 金币: 1 } }], { mes: 'x'.repeat(9 * 1024 * 1024) });
  const result = parseSourceImport(JSON.stringify([row]));
  assert.deepEqual(sourceFromChat(result, result.selectedId).statData, { 金币: 1 });
});
