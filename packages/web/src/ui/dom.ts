// Tiny DOM builders — text only, never innerHTML

export type Attrs = Record<string, string | number | boolean | null | undefined>;
export type Child = Node | string | number | null | undefined | false;

/**
 * `el('div', { class: 'row' }, 'text', child)`.
 *
 * Strings become text nodes, so nothing user- or API-supplied is ever parsed as
 * HTML. `false`/null children are dropped, which makes conditional rendering
 * read as `cond && el(...)`.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      node.setAttribute(key, '');
      continue;
    }
    node.setAttribute(key, String(value));
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

/** A button wired to its handler in one expression. */
export function button(
  className: string,
  label: string,
  onClick: (e: MouseEvent) => void,
  attrs: Attrs = {},
): HTMLButtonElement {
  const btn = el('button', { class: className, type: 'button', ...attrs }, label);
  btn.addEventListener('click', onClick);
  return btn;
}

/** An error banner in the design's language: red tint, nothing-was-written. */
export function errorPanel(message: string, retry?: () => void): HTMLElement {
  const panel = el('div', { class: 'error-panel' }, el('p', {}, message));
  if (retry) panel.appendChild(button('btn', 'retry', retry));
  return panel;
}

export function loadingRow(label: string): HTMLElement {
  return el('div', { class: 'loading' }, label);
}
