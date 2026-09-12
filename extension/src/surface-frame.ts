import { card } from './cards';
import type { SurfaceCard } from './surface-types';
const nonce = location.hash.slice(1);
const root = document.getElementById('surface')!;
root.style.visibility = 'hidden';
let expires: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let leaving = false;
async function send(type: string, values: Record<string, unknown> = {}) {
  const result = await chrome.runtime.sendMessage({ type, nonce, ...values });
  if (!result?.ok) throw new Error('Page card is unavailable.');
  return result.value;
}
async function dismiss() {
  if (leaving) return; leaving = true; clearTimeout(expires); clearInterval(heartbeat);
  root.classList.remove('spark-enter'); root.classList.add('spark-exit');
  setTimeout(() => { root.replaceChildren(); void send('surface-dismiss').catch(() => undefined); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
}
async function start() {
  if (!/^[0-9a-f-]{36}$/.test(nonce)) return;
  const data: SurfaceCard = await send('surface-ready');
  if (Date.now() >= data.expiresAt) return;
  if (data.listening) {
    const pill = document.createElement('div'); pill.className = 'spark-listening';
    const dot = document.createElement('span'); dot.className = 'spark-dot'; dot.setAttribute('aria-hidden','true');
    pill.append(dot, document.createTextNode('Spark · listening on device')); root.append(pill);
    heartbeat = setInterval(() => { void send('surface-poll').then(value => { if (!value.listening) void dismiss(); }).catch(() => dismiss()); }, 3000);
  } else {
    const node = card(data.kind, data.title, data.body, data.meta);
    const close = document.createElement('button'); close.className = 'dismiss'; close.textContent = '×'; close.setAttribute('aria-label','Dismiss Spark card'); close.onclick = event => { if (event.isTrusted) void dismiss(); }; node.append(close);
    if (data.actions.length) {
      const actions = document.createElement('div'); actions.className = 'spark-actions';
      for (const action of data.actions) {
        const button = document.createElement('button'); button.textContent = action === 'join' ? 'Join meeting' : 'Review in Spark';
        button.onclick = event => {
          if (!event.isTrusted) return;
          button.disabled = true;
          void send('surface-action', { action }).then(dismiss).catch(() => { button.disabled = false; });
        }; actions.append(button);
      }
      node.append(actions);
    }
    // No live region and no autofocus: a capture acknowledgement must not steal attention.
    root.append(node);
  }
  await send('surface-size', { height: Math.ceil(root.getBoundingClientRect().height) + 4 });
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (document.visibilityState !== 'visible') { await dismiss(); return; }
  await send('surface-shown');
  root.style.visibility = 'visible';
  root.classList.add('spark-enter');
  expires = setTimeout(() => void dismiss(), Math.max(0,data.expiresAt-Date.now()));
}
void start().catch(() => { root.replaceChildren(); });
