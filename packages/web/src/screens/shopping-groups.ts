// Pure aisle grouping, the pantry-arithmetic line, and category color — no
// DOM, so aisle order and phrasing are unit-tested without mounting a screen.
//
// The server already sorts items non-staples-first, then category
// alphabetically, then name, then id (shopping-sort.ts) — grouping here must
// only bucket that array by category, never re-sort within a bucket. A staple
// the server put last inside its category has to stay last: re-sorting would
// throw that ordering away.

import type { ShoppingItem } from '../api/types.js';
import { formatQuantity, toNumber } from '../format/quantity.js';

export const AISLE_ORDER = [
  'produce',
  'protein',
  'dairy',
  'grain',
  'condiment',
  'spice',
  'other',
] as const;

export interface CategoryGroup {
  category: string;
  items: ShoppingItem[];
}

/**
 * Buckets by category, preserving arrival order inside each bucket, then
 * emits buckets in aisle order. A category the aisle vocabulary doesn't name
 * (e.g. 'frozen') is appended after, in the order its first item appeared —
 * a Map's iteration order already gives us that for free.
 */
export function groupByAisle(items: ShoppingItem[]): CategoryGroup[] {
  const buckets = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.category);
    if (bucket) bucket.push(item);
    else buckets.set(item.category, [item]);
  }

  const ordered: CategoryGroup[] = [];
  for (const category of AISLE_ORDER) {
    const bucket = buckets.get(category);
    if (bucket) {
      ordered.push({ category, items: bucket });
      buckets.delete(category);
    }
  }
  for (const [category, bucket] of buckets) {
    ordered.push({ category, items: bucket });
  }
  return ordered;
}

const CATEGORY_COLORS: Record<string, string> = {
  produce: 'var(--green)',
  protein: 'var(--red)',
  dairy: 'var(--blue)',
  grain: 'var(--orange)',
  condiment: 'var(--purple)',
};

/** Named aisles get their design color; everything else (spice, other, an
 * unnamed category) reads as muted chrome rather than competing for attention. */
export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? 'var(--fg-3)';
}

/**
 * The honest pantry-coverage line. Phrasing is pinned exactly rather than
 * derived ad hoc, because a pending change to what `quantityInPantry` means
 * must not silently make this read wrong.
 */
export function pantryLine(item: ShoppingItem): string {
  const inPantry = toNumber(item.quantityInPantry);
  const net = toNumber(item.netToBuy);
  if (inPantry === 0) return 'nothing in the pantry';
  if (net === 0) return 'covered by the pantry';
  return `pantry covers ${formatQuantity(inPantry, item.unit)} · ${formatQuantity(net, item.unit)} short`;
}
