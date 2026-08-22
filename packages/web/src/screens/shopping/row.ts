// Shopping list row rendering. The toggle surface (everything but the
// trailing delete control) is a real <button> so the whole row stays
// keyboard-accessible without nesting a button inside a button —
// the recipes list's whole-row click uses the same shape.

import type { ShoppingItem } from '../../api/types.js';
import { el, button } from '../../ui/dom.js';
import { formatQuantity, toNumber } from '../../format/quantity.js';
import { pantryLine } from './groups.js';

export interface RowHandlers {
  onToggle: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => void;
}

/** `source === 'manual'` and any `customNote` are the only provenance the API
 * gives us — there is no per-recipe line like the design's "lohikeitto ti". */
function provenanceLine(item: ShoppingItem): string | null {
  const parts: string[] = [];
  if (item.source === 'manual') parts.push('added by hand');
  if (item.customNote) parts.push(item.customNote);
  return parts.length ? parts.join(' · ') : null;
}

export function buildShoppingRow(
  item: ShoppingItem,
  readOnly: boolean,
  handlers: RowHandlers,
): HTMLElement {
  const ingredient = item.ingredient;
  const name = ingredient?.name ?? 'Unknown ingredient';
  const alias = ingredient?.aliases?.[0];
  const checked = item.bought;

  const checkbox = el(
    'span',
    { class: `shopping-check${checked ? ' is-checked' : ''}` },
    checked ? '✓' : '',
  );
  const titleLine = el(
    'div',
    { class: 'shopping-row-title-line' },
    el('span', { class: 'row-title' }, name),
    alias ? el('span', { class: 'shopping-alias' }, alias) : null,
  );
  const provenance = provenanceLine(item);
  const main = el(
    'div',
    { class: 'row-main' },
    titleLine,
    provenance ? el('div', { class: 'row-meta' }, provenance) : null,
  );
  const right = el(
    'div',
    { class: 'row-right' },
    el('div', { class: 'shopping-qty' }, formatQuantity(toNumber(item.netToBuy), item.unit)),
    el('div', { class: 'row-meta' }, pantryLine(item)),
  );

  // A done list is read-only: no toggle, no delete — the API 409s both, so
  // the UI must not offer either.
  const toggle: HTMLElement = readOnly
    ? el('div', { class: 'shopping-row-toggle' }, checkbox, main, right)
    : button('shopping-row-toggle', '', () => handlers.onToggle(item), {
        // The visible checkbox is a styled span, so the pressed state has to be
        // announced here or a screen reader gets a button with no state at all.
        // String, not boolean: el() renders `true` as a bare attribute and drops
        // `false` outright, and ARIA needs the literal "true"/"false".
        'aria-pressed': String(checked),
      });
  if (!readOnly) toggle.append(checkbox, main, right);

  const children: HTMLElement[] = [toggle];
  if (!readOnly) {
    children.push(
      button('btn btn-ghost shopping-more-btn', '⋯', () => handlers.onDelete(item), {
        'aria-label': `remove ${name}`,
      }),
    );
  }

  return el('div', { class: `row shopping-row${checked ? ' is-checked' : ''}` }, ...children);
}
