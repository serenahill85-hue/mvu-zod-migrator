import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDrag } from '../src/drag.mjs';

function surface({ width = 300, height = 200, stored, enabled } = {}) {
  const listeners = new Map(), memory = new Map(stored ? [['position', JSON.stringify(stored)]] : []);
  const win = { innerWidth: 800, innerHeight: 600, addEventListener(type, fn) { listeners.set('win-' + type, fn); }, removeEventListener(type) { listeners.delete('win-' + type); } };
  const node = { style: {}, addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, setPointerCapture() {}, releasePointerCapture() {}, getClientRects() { return [{}]; },
    getBoundingClientRect() { return { left: parseFloat(this.style.left || '250'), top: parseFloat(this.style.top || '200'), width, height }; } };
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const drag = attachDrag({ element: node, handles: [node], window: win, storage, key: 'position', enabled });
  function fire(type, props = {}) { const event = { type, target: node, button: 0, isPrimary: true, pointerId: 1, clientX: 270, clientY: 220, detail: 1, preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; }, ...props }; listeners.get(type)?.(event); return event; }
  return { drag, node, win, memory, listeners, fire };
}
test('移动有阈值，拖动后不误开；指针取消和销毁释放状态', () => {
  const f = surface(); f.drag.restore(); f.fire('pointerdown'); f.fire('pointermove', { clientX: 272 });
  assert.equal(f.node.style.left, '250px');
  f.fire('pointermove', { clientX: 370, clientY: 270 }); f.fire('pointerup');
  assert.equal(f.node.style.left, '350px'); assert.equal(f.node.style.top, '250px');
  assert.equal(f.fire('click').stopped, true); assert.equal(f.fire('click', { detail: 0 }).stopped, undefined);
  assert.deepEqual(JSON.parse(f.memory.get('position')), { left: 350, top: 250 });
  f.fire('pointerdown'); f.fire('pointercancel'); assert.equal(f.fire('click').stopped, true);
  f.fire('pointerdown'); f.fire('pointerup'); assert.equal(f.fire('click').stopped, undefined);
  f.drag.destroy(); assert.equal(f.listeners.size, 0);
});
test('恢复、缩屏、键盘移动均夹取到屏内', () => {
  const f = surface({ stored: { left: 9999, top: -88 } }); f.drag.restore();
  assert.equal(f.node.style.left, '496px'); assert.equal(f.node.style.top, '4px');
  f.fire('keydown', { key: 'ArrowLeft' }); assert.equal(f.node.style.left, '484px');
  f.fire('keydown', { key: 'ArrowDown', shiftKey: true }); assert.equal(f.node.style.top, '44px');
  f.win.innerWidth = 320; f.win.innerHeight = 300; f.listeners.get('win-resize')();
  assert.equal(f.node.style.left, '16px'); f.drag.destroy();
});
test('手机模式不拖动、不劫持触摸、不采用桌面位置；切回桌面后恢复', () => {
  let desktop = false;
  const f = surface({ enabled: () => desktop, stored: { left: 180, top: 150 } }); f.drag.restore();
  assert.equal(f.node.style.left, ''); assert.equal(f.node.style.touchAction, '');
  f.fire('pointerdown'); f.fire('pointermove', { clientX: 370 }); f.fire('pointerup'); f.fire('keydown', { key: 'ArrowLeft' }); assert.equal(f.node.style.left, '');
  assert.equal(f.fire('click').stopped, undefined);
  desktop = true; f.drag.restore(); assert.equal(f.node.style.left, '180px');
  desktop = false; f.listeners.get('win-resize')(); assert.equal(f.node.style.left, ''); assert.equal(f.node.style.touchAction, '');
  assert.deepEqual(JSON.parse(f.memory.get('position')), { left: 180, top: 150 }); f.drag.destroy();
});
