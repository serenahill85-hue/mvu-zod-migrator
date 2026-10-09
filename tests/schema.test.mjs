import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { discoverScripts, inspectSchema, validateSchema } from '../src/schema.mjs';

const source = (content, extra = {}) => [{ id: 'test', name: '测试结构', content, enabled: true, ...extra }];
const schema = expression => source(`const Schema = ${expression}; registerMvuSchema(Schema);`);
const globalCard = source(await readFile(new URL('./fixtures/schema-global.js', import.meta.url), 'utf8'));
const moduleCard = source(await readFile(new URL('./fixtures/schema-module.js', import.meta.url), 'utf8'));

test('discovers nested enabled and disabled scripts by source, not just name', () => {
  const scripts = discoverScripts([{ type: 'folder', enabled: false, value: { name: 'folder' }, children: [
    { type: 'script', value: { id: 'a', name: '不叫变量结构', content: globalCard[0].content, enabled: true } },
  ] }, { id: 'b', name: 'MVU Zod', content: 'alert(1)', enabled: true }, { id: 'c', content: 'hello' }]);
  assert.deepEqual(scripts.map(s => [s.id, s.enabled]), [['a', false], ['b', true]]);
  assert.ok(scripts[0].score > scripts[1].score);
});

test('global card: const references, nested record, defaults, coerce and dynamic keys', () => {
  const data = { 玩家: { 金币: '23' }, 角色: { 小青: { 名字: '小青', 好感度: '40', 额外经历: '保留' } } };
  const original = structuredClone(data), report = inspectSchema(globalCard), result = validateSchema(globalCard, data);
  assert.equal(report.status, 'supported');
  assert.ok(report.fields.some(f => f.path.join('.') === '角色.*.好感度'));
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.data, { 玩家: { 金币: 23, 地点: '街道' }, 角色: { 小青: { 名字: '小青', 好感度: 40, 关系: '陌生', 额外经历: '保留' } }, 背包: [], 开关: false });
  assert.deepEqual(data, original);
});

test('module card: import aliases, static enum object, shape spread and strict output', () => {
  const report = inspectSchema(moduleCard);
  assert.equal(report.status, 'supported');
  assert.equal(report.imports.length, 2);
  assert.equal(report.imports[0].specifier, 'zod');
  const data = { 进度: { id: 'first', 阶段: '开始', 完成时间: null }, 分数: 25 };
  const result = validateSchema(moduleCard, data);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.data, { 进度: { id: 'first', 阶段: '开始', 完成时间: null, active: false }, 分数: 25, 记录: [] });
  assert.equal(validateSchema(moduleCard, { ...data, 外来字段: 1 }).status, 'failed');
});

test('known violations fail even when another transform cannot be interpreted', () => {
  const scripts = schema(`z.object({ a: z.number().max(5), b: z.string().transform(v => v.trim()).refine(v => v.length > 0) })`);
  const r = validateSchema(scripts, { a: 6, b: 'x' });
  assert.equal(r.status, 'failed');
  assert.ok(r.errors.some(e => e.path.join('.') === 'a'));
  assert.equal(validateSchema(scripts, { a: 3, b: 'x' }).status, 'partial');
});

test('unknown preprocess is partial, not an invented conversion or false type failure', () => {
  const scripts = schema(`z.object({ a: z.preprocess(v => Number(v), z.number()), b: z.number() })`);
  assert.equal(validateSchema(scripts, { a: '2', b: 3 }).status, 'partial');
  assert.equal(validateSchema(scripts, { a: '2', b: 'bad' }).status, 'failed');
});

test('unknown fields are preserved and reported, never silently stripped', () => {
  const scripts = schema('z.object({ a: z.number() })');
  const r = validateSchema(scripts, { a: 1, historical: { key: false } });
  assert.equal(r.status, 'partial');
  assert.deepEqual(r.data.historical, { key: false });
  assert.match(r.warnings.join(' '), /额外字段 historical 已保留/);
  const strict = validateSchema(schema('z.object({ a: z.number() }).strict()'), { a: 1, extra: 2 });
  assert.equal(strict.status, 'failed');
  assert.equal(strict.data.extra, 2);
});

test('literal defaults preserve valid zero, false and empty strings; prefault validates', () => {
  const scripts = schema(`z.object({ a: z.number().default(8), b: z.boolean().prefault(true), c: z.string().default('x') })`);
  assert.deepEqual(validateSchema(scripts, { a: 0, b: false, c: '' }).data, { a: 0, b: false, c: '' });
  assert.deepEqual(validateSchema(scripts, {}).data, { a: 8, b: true, c: 'x' });
  assert.equal(validateSchema(schema('z.object({a:z.number().min(5).prefault(2)})'), {}).status, 'failed');
  assert.equal(validateSchema(schema('z.object({a:z.number().min(5).default(2)})'), {}).data.a, 2);
});

test('optional and nullable wrappers apply only to the permitted absence', () => {
  const scripts = schema(`z.object({ a: z.number().optional(), b: z.string().nullable(), c: z.string().nullish(), d: z.string().default('d').optional() })`);
  assert.deepEqual(validateSchema(scripts, { b: null }).data, { b: null, d: 'd' });
  assert.equal(validateSchema(scripts, { b: null, a: null }).status, 'failed');
  assert.equal(validateSchema(scripts, {}).status, 'failed');
});

test('literal constants and nested object properties are resolved without execution', () => {
  const scripts = source(`const D={start:-3};const E=['x','y'];const Sub=z.string().min(1);const Schema=z.object({n:z.number().default(D.start),t:Sub,k:z.enum(E)});registerMvuSchema(Schema);`);
  assert.equal(validateSchema(scripts, { t: 'ok', k: 'y' }).data.n, -3);
  assert.equal(validateSchema(scripts, { t: '', k: 'y' }).status, 'failed');
});

test('card code, callbacks, default functions and malicious calls are never executed', () => {
  globalThis.__migratorTestRan = false;
  const scripts = source(`globalThis.__migratorTestRan=true;fetch('https://example.invalid/steal');const Schema=z.object({n:z.number().default(()=>{globalThis.__migratorTestRan=true;return 9}),b:makeSchema()});registerMvuSchema(Schema);`);
  const r = validateSchema(scripts, {});
  assert.equal(globalThis.__migratorTestRan, false);
  assert.equal(r.status, 'partial');
  assert.deepEqual(r.data, {});
  delete globalThis.__migratorTestRan;
});

test('static and dynamic imports are identified but not fetched', () => {
  const scripts = source(`import { Remote } from './remote.js';const url='https://example.invalid/z.js';import(url);import('https://example.invalid/other.js');const Schema=z.object({a:Remote,b:z.number()});registerMvuSchema(Schema);`);
  const report = inspectSchema(scripts);
  assert.equal(report.status, 'partial');
  assert.equal(report.imports.length, 3);
  assert.deepEqual(report.imports.map(i => i.dynamic), [false, true, false]);
  assert.equal(validateSchema(scripts, { a: {}, b: 'bad' }).status, 'failed');
});

test('bad or unavailable source does not yield a passing result', () => {
  for (const scripts of [[], source(''), source('const = ;'), source('fetch("x")'), schema('buildSchema()')]) {
    const r = validateSchema(scripts, { kept: true });
    assert.equal(r.status, 'unavailable');
    assert.deepEqual(r.data, { kept: true });
  }
});

test('known dynamic record key and value constraints fail at actual entry paths', () => {
  const scripts = schema(`z.object({people:z.record(z.string().min(2),z.object({score:z.number().min(0).max(100)}))})`);
  const r = validateSchema(scripts, { people: { A: { score: 101 } } });
  assert.equal(r.status, 'failed');
  assert.ok(r.errors.some(e => e.path.join('.') === 'people.A.score'));
  assert.ok(r.errors.some(e => e.path.join('.') === 'people.A'));
});

test('enum-key record follows Zod 4 exhaustiveness and partialRecord accepts missing keys', () => {
  const shape = method => schema(`z.object({r:z.${method}(z.enum(['a','b']),z.number())})`);
  assert.equal(validateSchema(shape('record'), { r: { a: 1 } }).status, 'failed');
  assert.equal(validateSchema(shape('partialRecord'), { r: { a: 1 } }).status, 'passed');
});

test('multiple different roots do not silently select a schema; identical source alternatives dedupe', () => {
  const a = schema('z.object({a:z.string()})')[0];
  const b = schema('z.object({b:z.number()})')[0];
  assert.equal(validateSchema([a, { ...b, id: 'b' }], { a: 'x' }).status, 'partial');
  assert.equal(validateSchema([a, { ...a, id: 'copy' }], { a: 'x' }).status, 'passed');
});

test('lexical shadowing does not resolve a parameter as the outer constant', () => {
  const scripts = source(`const X=z.string(); function f(X){const Schema=z.object({a:X,b:z.number()});registerMvuSchema(Schema);}`);
  assert.equal(inspectSchema(scripts).status, 'partial');
  assert.equal(validateSchema(scripts, { a: 3, b: 'bad' }).status, 'failed');
});

test('unknown spread does not discard independent known field constraints', () => {
  const scripts = schema(`z.object({ a:z.number().min(1), ...remoteShape, b:z.string() })`);
  const r = validateSchema(scripts, { a: 0, b: 'ok' });
  assert.equal(r.status, 'failed');
  assert.ok(r.errors.some(e => e.path.join('.') === 'a'));
});

test('dangerous JSON keys, cycles and accessors are rejected without calling accessors', () => {
  assert.equal(validateSchema(schema('z.any()'), JSON.parse('{"__proto__":{"p":1}}')).status, 'failed');
  const circular = {}; circular.self = circular;
  assert.equal(validateSchema(schema('z.any()'), circular).status, 'failed');
  let called = false; const value = {}; Object.defineProperty(value, 'a', { enumerable: true, get() { called = true; return 1; } });
  assert.equal(validateSchema(schema('z.any()'), value).status, 'failed');
  assert.equal(called, false);
});

test('size/length, union, catchall, partial and extend are constrained', () => {
  const scripts = schema(`z.object({ a: z.union([z.string().length(2),z.number().int()]), b:z.object({x:z.number()}).partial().extend({y:z.boolean().default(false)}), c:z.object({}).catchall(z.number()) })`);
  assert.equal(validateSchema(scripts, { a: 'ok', b: {}, c: { custom: 2 } }).status, 'passed');
  assert.equal(validateSchema(scripts, { a: 'nope', b: {}, c: { custom: 'bad' } }).status, 'failed');
});

test('runtime mutation and unknown consumers cannot become a complete check', () => {
  const mutated = source(`const Fields={a:z.number()};const Schema=z.object(Fields);Fields.a=z.string();registerMvuSchema(Schema);`);
  assert.equal(inspectSchema(mutated).status, 'partial');
  const consumed = source(`const Schema=z.object({a:z.number()});mutateSchema(Schema);registerMvuSchema(Schema);`);
  assert.equal(inspectSchema(consumed).status, 'partial');
});

test('destructured or declared local z does not impersonate the host z global', () => {
  for (const prefix of [`const {z}=external;`, `function z(){}`, `const z=evil;`]) {
    const scripts = source(`${prefix}const Schema=z.object({a:z.number()});registerMvuSchema(Schema);`);
    assert.equal(inspectSchema(scripts).status, 'unavailable');
  }
});

test('catch fallback remains partial and cannot silently hide invalid data', () => {
  const result = validateSchema(schema('z.object({a:z.number().catch(0),b:z.number()})'), { a: 'bad', b: 2 });
  assert.equal(result.status, 'partial');
  assert.equal(result.data.a, 'bad');
  assert.equal(validateSchema(schema('z.object({a:z.number().catch(0),b:z.number()})'), { a: 'bad', b: 'bad' }).status, 'failed');
});

test('enum record defaults fill missing keys and decimal multipleOf avoids float error', () => {
  const result = validateSchema(schema(`z.object({r:z.record(z.enum(['a','b']),z.number().default(0)), n:z.number().multipleOf(0.1)})`), { r: { a: 1 }, n: 6.3 });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.data.r, { a: 1, b: 0 });
  assert.equal(validateSchema(schema('z.object({a:z.unknown()})'), {}).status, 'failed');
});

test('supported subset agrees with optional installed Zod 4 oracle', { skip: !process.env.MIGRATOR_ZOD_ORACLE }, async () => {
  const { z } = await import(pathToFileURL(process.env.MIGRATOR_ZOD_ORACLE).href);
  const cases = [
    ['z.object({a:z.number().min(2)})', z.object({ a: z.number().min(2) }), { a: 1 }],
    ['z.object({a:z.number().min(2)})', z.object({ a: z.number().min(2) }), { a: 2 }],
    ['z.object({a:z.number().default(1)})', z.object({ a: z.number().default(1) }), {}],
    ['z.object({a:z.number().min(2).prefault(1)})', z.object({ a: z.number().min(2).prefault(1) }), {}],
    ['z.object({a:z.coerce.number()})', z.object({ a: z.coerce.number() }), { a: '4' }],
    ['z.object({a:z.coerce.boolean()})', z.object({ a: z.coerce.boolean() }), { a: 'false' }],
    ['z.object({a:z.coerce.string()})', z.object({ a: z.coerce.string() }), { a: 0 }],
    ['z.object({a:z.string().default("d").optional()})', z.object({ a: z.string().default('d').optional() }), {}],
    ['z.object({a:z.string().default("d").nullable().optional()})', z.object({ a: z.string().default('d').nullable().optional() }), {}],
    ['z.object({a:z.string().nullish()})', z.object({ a: z.string().nullish() }), { a: null }],
    ['z.object({a:z.any()})', z.object({ a: z.any() }), {}],
    ['z.object({a:z.unknown()})', z.object({ a: z.unknown() }), {}],
    ['z.record(z.enum(["a","b"]),z.number().default(0))', z.record(z.enum(['a', 'b']), z.number().default(0)), {}],
    ['z.record(z.enum(["a","b"]),z.number())', z.record(z.enum(['a', 'b']), z.number()), { a: 1 }],
    ['z.array(z.string()).max(1)', z.array(z.string()).max(1), ['a', 'b']],
    ['z.number().multipleOf(.1)', z.number().multipleOf(.1), 6.3],
    ['z.number().multipleOf(.1)', z.number().multipleOf(.1), 6.31],
    ['z.object({a:z.number()}).passthrough()', z.object({ a: z.number() }).passthrough(), { a: 1, keep: 'yes' }],
    ['z.object({a:z.number()}).strict()', z.object({ a: z.number() }).strict(), { a: 1, keep: 'yes' }],
  ];
  for (const [expression, native, value] of cases) {
    const actual = validateSchema(schema(expression), value), expected = native.safeParse(value);
    assert.equal(actual.status, expected.success ? 'passed' : 'failed', expression);
    if (expected.success) assert.deepEqual(actual.data, expected.data, expression);
  }
});
