// Cook confirm table rows: one deduction with its FEFO lots, or one shortfall line.

import { el } from '../ui/dom.js';
import { formatQuantity, toNumber } from '../format/quantity.js';
import { finnishDate, daysUntil } from '../format/date.js';
import { baseUnit } from '@diet-app/api/vocab';
import type { Deduction, Shortfall, PantryItem } from '../api/types.js';

/** How urgent the lot is — the second half of the provenance line. */
function expiryLabel(expiresDate: string): string {
  const days = daysUntil(expiresDate);
  if (days < 0) return `EXPIRED ${Math.abs(days)}d`;
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires in 1 day';
  return `expires in ${days} days`;
}

export function nameOf(map: Map<string, string>, ingredientId: string): string {
  return map.get(ingredientId) ?? ingredientId;
}

export function shortfallText(s: Shortfall, name: string): string {
  if (s.reason === 'not_in_pantry') return `${name} — not in pantry — buy first`;
  if (s.reason === 'unit_mismatch') {
    return `${name} — units don't convert (mass/volume/count only)`;
  }
  const unit = s.dimension ? baseUnit(s.dimension) : '';
  return `${name} — short ${formatQuantity(s.requested - s.available, unit)}`;
}

export function renderDeduction(
  d: Deduction,
  name: string,
  pantryById: Map<string, PantryItem>,
): HTMLElement {
  const lots = d.pantryItems.map((p) => {
    const item = pantryById.get(p.id);
    const before = toNumber(p.before);
    const after = toNumber(p.after);
    // A lot is identified by when it came in, not when it goes off: the
    // design's own "lot 2.8. · expires today" only reads as one thing if the
    // two dates are different, and two lots of the same ingredient are told
    // apart by their purchase date.
    const provenance = item
      ? `lot ${finnishDate(item.addedDate)} · ${expiryLabel(item.expiresDate)}${item.opened ? ' · opened' : ''}`
      : 'lot ?';
    return el(
      'div',
      { class: 'cook-lot-row' },
      el('span', { class: 'cook-lot-info' }, provenance),
      el('span', { class: 'cook-lot-amount' }, `−${formatQuantity(before - after, p.unit)}`),
      el('span', { class: 'cook-lot-left' }, `${formatQuantity(after, p.unit)} left`),
    );
  });
  return el('div', { class: 'cook-item' }, el('div', { class: 'cook-item-name' }, name), ...lots);
}
