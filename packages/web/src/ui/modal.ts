// Modal primitive: backdrop, Escape, focus trap, one open at a time

export interface ModalOptions {
  /** Left side of the header, 700 weight. */
  title: string;
  /** Right side of the header, muted. */
  meta?: string;
  body: HTMLElement;
  /** Right-aligned footer controls; omitted renders no footer rim. */
  footer?: HTMLElement;
  /** Frame width in px (design: 520 for cook confirm, 420 for feedback). */
  width?: number;
  onClose?: () => void;
}

export interface ModalHandle {
  readonly frame: HTMLElement;
  readonly body: HTMLElement;
  close(): void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let open: { backdrop: HTMLElement; onClose?: () => void; restore: Element | null } | null =
  null;

export function isModalOpen(): boolean {
  return open !== null;
}

/** Close whatever modal is open. Safe to call when none is. */
export function closeModal(): void {
  if (!open) return;
  const { backdrop, onClose, restore } = open;
  open = null;
  backdrop.remove();
  document.removeEventListener('keydown', onKeydown, true);
  if (restore instanceof HTMLElement) restore.focus();
  onClose?.();
}

function onKeydown(e: KeyboardEvent): void {
  if (!open) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.key !== 'Tab') return;

  // Trap: the modal is the whole interactive surface while it is up.
  const items = [...open.backdrop.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !open.backdrop.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

export function openModal(opts: ModalOptions): ModalHandle {
  closeModal();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeModal();
  });

  const frame = document.createElement('div');
  frame.className = 'modal modal-frame';
  frame.setAttribute('role', 'dialog');
  frame.setAttribute('aria-modal', 'true');
  frame.setAttribute('aria-label', opts.title);
  if (opts.width) frame.style.width = `${opts.width}px`;

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('span');
  title.className = 'modal-title';
  title.textContent = opts.title;
  head.appendChild(title);
  if (opts.meta) {
    const meta = document.createElement('span');
    meta.className = 'modal-meta';
    meta.textContent = opts.meta;
    head.appendChild(meta);
  }

  // flex:1 1 auto + min-height:0, never a 0 basis: the frame's height comes
  // only from max-height, and a 0 basis collapses the body to nothing there.
  const body = opts.body;
  body.classList.add('modal-body');

  frame.append(head, body);
  if (opts.footer) {
    opts.footer.classList.add('modal-foot');
    frame.appendChild(opts.footer);
  }
  backdrop.appendChild(frame);
  document.body.appendChild(backdrop);

  open = {
    backdrop,
    restore: document.activeElement,
    ...(opts.onClose ? { onClose: opts.onClose } : {}),
  };
  document.addEventListener('keydown', onKeydown, true);
  backdrop.querySelector<HTMLElement>(FOCUSABLE)?.focus();

  return { frame, body, close: closeModal };
}
