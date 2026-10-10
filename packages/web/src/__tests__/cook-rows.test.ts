// Cook confirm lot rows: the provenance line's urgency label and opened marker

import { describe, test, expect } from 'vitest';
import { renderDeduction } from '../modals/cook-rows.js';
import type { Deduction, PantryItem } from '../api/types.js';

import { makePantryItem } from './fixtures.js';

function isoDaysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The provenance text of a one-lot deduction drawn from `item`. */
function lotText(item: PantryItem): string {
  const deduction: Deduction = {
    ingredientId: item.ingredientId,
    dimension: 'mass',
    requested: 100,
    deducted: 100,
    pantryItems: [{ id: item.id, unit: 'g', before: '400', after: '300', deleted: false }],
  };
  const row = renderDeduction(deduction, 'Salmon', new Map([[item.id, item]]));
  return row.querySelector('.cook-lot-info')!.textContent!;
}

describe('cook lot provenance', () => {
  test.each([
    [-3, 'EXPIRED 3d'],
    [0, 'expires today'],
    [1, 'expires in 1 day'],
    [5, 'expires in 5 days'],
  ])('a lot expiring in %i days reads "%s"', (days, label) => {
    const text = lotText(makePantryItem({ expiresDate: isoDaysFromNow(days) }));
    expect(text).toMatch(/^lot \S+ · /);
    expect(text.endsWith(` · ${label}`)).toBe(true);
  });

  test('an opened lot appends the opened marker after the urgency', () => {
    const text = lotText(makePantryItem({ expiresDate: isoDaysFromNow(1), opened: true }));
    expect(text.endsWith(' · expires in 1 day · opened')).toBe(true);
  });

  test('an unopened lot carries no opened marker', () => {
    expect(lotText(makePantryItem({ opened: false }))).not.toContain('opened');
  });
});
