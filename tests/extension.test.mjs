import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createExtension } from '../extension.js';
import { TOOL_VERSION } from '../src/host.mjs';

const SINGLETON = '__MVU_ZOD_MIGRATOR_V1__';
function setup({ helper = true, existing, fail = false } = {}) {
  const events = new EventEmitter(), page = new EventEmitter(), timers = new Map(), nodes = [], errors = [];
  let nextId = 0, starts = 0, destroys = 0, opens = 0;
  const env = {
    SillyTavern: { getContext: () => ({ eventSource: events, eventTypes: { APP_READY: 'ready' } }) },
    document: {
      body: { append: node => nodes.push(node) },
      createElement: () => ({ style: {}, addEventListener(type, fn) { this[type] = fn; }, remove() { const index = nodes.indexOf(this); if (index >= 0) nodes.splice(index, 1); } }),
    },
    setTimeout: fn => { timers.set(++nextId, fn); return nextId; }, clearTimeout: id => timers.delete(id),
    addEventListener: (type, fn) => page.on(type, fn), removeEventListener: (type, fn) => page.off(type, fn),
    toastr: { error: message => errors.push(message) },
  };
  const installHelper = () => { env.TavernHelper = Object.fromEntries(['getVariables', 'replaceVariables', 'getChatMessages', 'generateRaw', 'stopGenerationById'].map(name => [name, () => {}])); };
  if (helper) installHelper();
  if (existing) env[SINGLETON] = existing;
  const extension = createExtension(env, () => {
    starts++;
    if (fail) throw new Error('启动失败');
    let dead = false;
    const app = { open() { opens++; }, destroy() { if (dead) return; dead = true; destroys++; if (env[SINGLETON] === app) delete env[SINGLETON]; } };
    env[SINGLETON] = app; return app;
  });
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { env, events, page, timers, nodes, errors, extension, installHelper, flush, counts: () => ({ starts, destroys, opens }) };
}

test('extension activation defers work and cleans owned UI and listeners on disable', () => {
  const s = setup();
  assert.equal(s.counts().starts, 0);
  s.flush(); assert.equal(s.counts().starts, 1);
  assert.equal(s.events.listenerCount('ready'), 0);
  s.extension.destroy(); s.extension.destroy();
  assert.equal(s.counts().destroys, 1);
  assert.equal(s.page.listenerCount('pagehide'), 0);
  assert.equal(s.env[SINGLETON], undefined);
});

test('missing Helper never starts the migrator; APP_READY can finish deferred initialization', () => {
  const s = setup({ helper: false }); s.flush();
  assert.equal(s.counts().starts, 0); assert.equal(s.nodes.length, 1); assert.equal(s.errors.length, 0);
  assert.match(s.nodes[0].title, /安装并启用酒馆助手/);
  s.installHelper(); s.events.emit('ready');
  assert.equal(s.counts().starts, 1); assert.equal(s.nodes.length, 0);
  assert.equal(s.events.listenerCount('ready'), 0); s.extension.destroy();
});

test('missing capability stays explicit and the retry button starts once after recovery', () => {
  const s = setup(); delete s.env.TavernHelper.replaceVariables; s.flush();
  assert.equal(s.counts().starts, 0); s.nodes[0].click();
  assert.match(s.errors[0], /replaceVariables/);
  s.installHelper(); s.nodes[0].click();
  assert.deepEqual(s.counts(), { starts: 1, destroys: 0, opens: 1 });
  assert.equal(s.nodes.length, 0); s.extension.destroy();
});

test('an existing JSON-script instance is reused and is never owned or destroyed by the extension', () => {
  let destroyed = 0;
  const existing = { open() {}, destroy() { destroyed++; } };
  const s = setup({ existing }); s.flush(); s.extension.destroy();
  assert.equal(s.counts().starts, 0); assert.equal(destroyed, 0); assert.equal(s.env[SINGLETON], existing);
});

test('disable before initialization cancels scheduled startup and ready events', () => {
  const s = setup(); s.extension.destroy(); s.flush(); s.events.emit('ready');
  assert.equal(s.counts().starts, 0); assert.equal(s.timers.size, 0); assert.equal(s.events.listenerCount('ready'), 0);
});

test('page exit cleans only the instance started by this extension', () => {
  const s = setup(); s.flush();
  const replacement = { destroy() { throw new Error('must preserve replacement'); } };
  s.env[SINGLETON] = replacement; s.page.emit('pagehide');
  assert.equal(s.counts().destroys, 1); assert.equal(s.env[SINGLETON], replacement);
  assert.equal(s.page.listenerCount('pagehide'), 0);
});

test('startup failure remains retryable and cleanup removes the failure entry', () => {
  const s = setup({ fail: true }); s.flush();
  assert.equal(s.nodes.length, 1); assert.match(s.nodes[0].title, /启动失败/);
  s.nodes[0].click(); assert.equal(s.counts().starts, 2);
  s.extension.destroy(); assert.equal(s.nodes.length, 0); assert.equal(s.events.listenerCount('ready'), 0);
});

test('extension, package and script versions match and manifest hooks are exported', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const entry = await import('../extension.js');
  assert.equal(manifest.version, TOOL_VERSION); assert.equal(pkg.version, TOOL_VERSION);
  assert.equal(manifest.auto_update, false);
  for (const name of Object.values(manifest.hooks)) assert.equal(typeof entry[name], 'function');
});
