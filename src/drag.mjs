/** Desktop titlebar positioning; mobile keeps the CSS layout, never game data. */
export function attachDrag({ element, handles, window: win, storage, key, enabled = () => true }) {
  let gesture = null, position = null, suppressClick = false, dead = false;
  const listeners = [], originalStyles = handles.map(handle => [handle, handle.style.touchAction, handle.style.userSelect]);
  const originalGeometry = Object.fromEntries(['position', 'margin', 'right', 'bottom', 'left', 'top'].map(name => [name, element.style[name] || '']));
  const listen = (node, type, fn, options) => { if (!node?.addEventListener) return; node.addEventListener(type, fn, options); listeners.push(() => node.removeEventListener(type, fn, options)); };
  const viewport = () => {
    const vv = win?.visualViewport;
    return { x: vv?.offsetLeft || 0, y: vv?.offsetTop || 0, width: vv?.width || win?.innerWidth || 1024, height: vv?.height || win?.innerHeight || 768 };
  };
  function move(left, top) {
    const box = element.getBoundingClientRect(), area = viewport(), gap = 4;
    position = { left: Math.max(area.x + gap, Math.min(left, area.x + Math.max(gap, area.width - box.width - gap))), top: Math.max(area.y + gap, Math.min(top, area.y + Math.max(gap, area.height - box.height - gap))) };
    Object.assign(element.style, { position: 'fixed', margin: '0', right: 'auto', bottom: 'auto', left: `${position.left}px`, top: `${position.top}px` });
  }
  const save = () => { if (position) try { storage?.setItem(key, JSON.stringify(position)); } catch {} };
  function finish(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const current = gesture; gesture = null;
    suppressClick = current.moved || event.type === 'pointercancel';
    try { current.handle.releasePointerCapture(current.id); } catch {}
    if (current.moved) save();
  }
  for (const handle of handles) {
    listen(handle, 'pointerdown', event => {
      if (!enabled() || gesture || event.isPrimary === false || event.button !== 0) return;
      if (event.target !== handle && event.target.closest?.('button,input,textarea,select,a,summary')) return;
      suppressClick = false;
      const box = element.getBoundingClientRect();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, handle, moved: false };
      try { handle.setPointerCapture(event.pointerId); } catch {}
    });
    listen(handle, 'pointermove', event => {
      if (!enabled() || !gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
      gesture.moved = true; event.preventDefault(); move(gesture.left + dx, gesture.top + dy);
    });
    listen(handle, 'pointerup', finish); listen(handle, 'pointercancel', finish); listen(handle, 'lostpointercapture', finish);
    listen(handle, 'click', event => { if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; } }, true);
    listen(handle, 'keydown', event => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!enabled() || !delta || event.target !== handle) return;
      event.preventDefault(); event.stopPropagation(); const box = element.getBoundingClientRect(), step = event.shiftKey ? 40 : 12;
      move(box.left + delta[0] * step, box.top + delta[1] * step); save();
    });
  }
  function configure() {
    const active = enabled();
    for (const [handle, touchAction, userSelect] of originalStyles) { handle.style.touchAction = active ? 'none' : touchAction || ''; handle.style.userSelect = active ? 'none' : userSelect || ''; }
    if (!active) { if (gesture) finish({ pointerId: gesture.id, type: 'pointercancel' }); Object.assign(element.style, originalGeometry); }
    return active;
  }
  const clamp = () => { if (!dead && configure() && element.getClientRects().length) { const box = element.getBoundingClientRect(); move(position?.left ?? box.left, position?.top ?? box.top); } };
  configure();
  listen(win, 'resize', clamp); listen(win?.visualViewport, 'resize', clamp); listen(win?.visualViewport, 'scroll', clamp);
  return {
    restore() {
      if (dead || !element.getBoundingClientRect || !configure()) return;
      if (!position) try { const saved = JSON.parse(storage?.getItem(key) || 'null'); if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) position = saved; } catch {}
      if (position) move(position.left, position.top); else clamp();
    },
    destroy() { if (dead) return; dead = true; if (gesture) finish({ pointerId: gesture.id, type: 'pointercancel' }); listeners.splice(0).forEach(fn => fn()); for (const [handle, touchAction, userSelect] of originalStyles) { handle.style.touchAction = touchAction; handle.style.userSelect = userSelect; } }
  };
}
