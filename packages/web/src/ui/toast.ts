// say(msg) — one bottom-right toast, 2600ms, previous timer cleared first

export type ToastKind = 'success' | 'error' | 'warning';

const DISMISS_MS = 2600;

let container: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let current: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container?.isConnected) return container;
  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/** Remove the visible toast and cancel its timer. */
export function clearToast(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  current?.remove();
  current = null;
}

/**
 * Show a toast. The timer is scheduled here, at the call site, and the previous
 * one is cleared first — deriving dismissal from a lifecycle diff leaked a
 * permanent toast in the prototype.
 */
export function say(message: string, kind: ToastKind = 'success'): void {
  clearToast();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  el.setAttribute('role', 'status');
  el.addEventListener('click', clearToast);
  ensureContainer().appendChild(el);
  current = el;
  timer = setTimeout(clearToast, DISMISS_MS);
}
