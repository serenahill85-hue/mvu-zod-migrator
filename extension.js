import { launch } from './src/main.mjs';

const SINGLETON = '__MVU_ZOD_MIGRATOR_V1__';
const REQUIRED = ['getVariables', 'replaceVariables', 'getChatMessages', 'generateRaw', 'stopGenerationById'];

// The extension and JSON script share the same UI, storage and migration logic.
export function createExtension(env = globalThis, start = launch) {
  let disposed = false, owned = null, hint = null, timer = null, removeReady = () => {};
  function removeHint() { hint?.remove(); hint = null; }
  function showHint(message) {
    if (!env.document?.body) return;
    if (!hint) {
      hint = env.document.createElement('button');
      hint.id = 'mvu-zod-migrator-start'; hint.type = 'button';
      hint.style.cssText = 'position:fixed;right:12px;top:64px;z-index:99990;min-height:44px;max-width:calc(100vw - 24px);padding:8px 15px;border:1px solid #cbc7be;border-radius:6px;background:#f7f6f2;color:#303030;font:14px sans-serif;cursor:pointer;';
      hint.addEventListener('click', () => attempt(true));
      env.document.body.append(hint);
    }
    hint.textContent = '存档迁移 · 点击重试'; hint.title = message;
  }
  function attempt(open = false) {
    if (disposed) return;
    if (env[SINGLETON]) {
      removeHint(); removeReady();
      if (open) env[SINGLETON].open?.();
      return;
    }
    try {
      if (!env.SillyTavern?.getContext?.()) throw new Error('请在 SillyTavern 中启用存档迁移扩展。');
      const missing = REQUIRED.filter(name => typeof env.TavernHelper?.[name] !== 'function');
      if (missing.length) throw new Error('请先安装并启用酒馆助手，再刷新酒馆。缺少接口：' + missing.join('、'));
      owned = start(env);
      removeHint(); removeReady();
      if (open) owned.open?.();
    } catch (error) {
      const message = String(error?.message || '存档迁移助手启动失败，请刷新后重试。');
      showHint(message);
      if (open) env.toastr?.error?.(message, '存档迁移');
    }
  }
  let context;
  try { context = env.SillyTavern?.getContext?.(); } catch {}
  const readyEvent = context?.eventTypes?.APP_READY;
  const events = context?.eventSource;
  const onReady = () => attempt();
  if (readyEvent && typeof events?.on === 'function' && typeof events?.removeListener === 'function') {
    events.on(readyEvent, onReady);
    removeReady = () => { events.removeListener(readyEvent, onReady); };
  }
  // Do not block the host's activate hook; APP_READY covers deferred Helper setup.
  timer = env.setTimeout(() => { timer = null; attempt(); }, 0);
  function destroy() {
    if (disposed) return;
    disposed = true;
    if (timer !== null) env.clearTimeout(timer);
    removeReady(); removeHint(); owned?.destroy?.(); owned = null;
    env.removeEventListener('pagehide', destroy);
  }
  env.addEventListener('pagehide', destroy, { once: true });
  return { destroy };
}

let extension;
export function activate() { extension ??= createExtension(); }
export function deactivate() { extension?.destroy(); extension = undefined; }
