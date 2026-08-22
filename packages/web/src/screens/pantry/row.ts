// Pantry row rendering. The API's `status` drives the ramp; days-remaining
// is display-only maths layered on top of it, never a substitute for it.

import type { Ingredient, PantryItem, PantryStatus } from '../../api/types.js';
import { el, button } from '../../ui/dom.js';
import { formatQuantity, toNumber } from '../../format/quantity.js';
import { finnishDate, daysUntil, daysRemainingLabel } from '../../format/date.js';
import { rampColor, applyRamp, statusLabel } from '../../format/expiry.js';

/** "use soon · 2 days" / "expired 1d ago" — the design's two joining styles. */
function expiryStatusLine(status: PantryStatus, days: number): string {
  const label = statusLabel(status);
  const remaining = daysRemainingLabel(days);
  return status === 'expired' ? `${label} ${remaining}` : `${label} · ${remaining}`;
}

export function buildPantryRow(
  item: PantryItem,
  ingredient: Ingredient | undefined,
  onOpenMenu: () => void,
): HTMLElement {
  const name = ingredient?.name ?? 'Unknown ingredient';
  const alias = ingredient?.aliases?.[0];
  const category = ingredient?.category ?? '';
  const days = daysUntil(item.expiresDate);
  const ramp = rampColor(item.status);

  const titleLine = el(
    'div',
    { class: 'pantry-row-title-line' },
    el('span', { class: 'row-title' }, name),
    alias ? el('span', { class: 'pantry-alias' }, alias) : null,
    item.opened ? el('span', { class: 'label label-muted' }, 'opened') : null,
  );
  const metaLine = el(
    'div',
    { class: 'row-meta' },
    [category, item.location, `added ${finnishDate(item.addedDate)}`].filter(Boolean).join(' · '),
  );
  const qtyLine = el(
    'div',
    { class: 'pantry-qty' },
    formatQuantity(toNumber(item.quantity), item.unit),
  );
  const statusLineEl = el('div', { class: 'pantry-status-line' }, expiryStatusLine(item.status, days));
  statusLineEl.style.color = ramp.text;

  const moreBtn = button('btn btn-ghost pantry-more-btn', '⋯', onOpenMenu, {
    'aria-label': `edit ${name}`,
  });

  const row = el(
    'div',
    { class: 'row pantry-row' },
    el('div', { class: 'row-main' }, titleLine, metaLine),
    el('div', { class: 'row-right pantry-row-right' }, qtyLine, statusLineEl),
    moreBtn,
  );
  applyRamp(row, item.status);
  return row;
}
