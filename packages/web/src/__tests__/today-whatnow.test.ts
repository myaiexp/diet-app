// Today "what now" pantry rows: the expiring-today and expired sentences, their counts, and where they lead.

import './pin-sunday.js';
import { describe, test, expect, vi } from 'vitest';
import { buildWhatNowPanel } from '../screens/today/whatnow.js';
import { mondayOf, isoToday } from '../format/date.js';
import type { PantryItem } from '../api/types.js';
import { makeIngredient, makePantryItem } from './fixtures.js';

const MONDAY = mondayOf(isoToday());

function panel(pantry: PantryItem[]) {
  const navigate = vi.fn();
  const root = buildWhatNowPanel([], pantry, MONDAY, new Map(), navigate);
  const rows = [...root.querySelectorAll<HTMLButtonElement>('.today-whatnow-row')];
  const row = (text: string) => rows.find((r) => r.textContent?.includes(text));
  return { navigate, row };
}

const item = (id: string, status: PantryItem['status'], name: string) =>
  makePantryItem({ id, status, ingredient: makeIngredient({ name }) });

describe('what now pantry rows', () => {
  test('one use_today item and two expired items: singular, plural, and each row\'s route', () => {
    const { navigate, row } = panel([
      item('p-today', 'use_today', 'Salmon'),
      item('p-dill', 'expired', 'Dill'),
      item('p-milk', 'expired', 'Milk'),
    ]);

    const expiringRow = row('expiring today');
    expect(expiringRow?.textContent).toContain('1 item expiring today — plan them into tonight');
    expiringRow!.click();
    expect(navigate).toHaveBeenLastCalledWith('/plan');

    const expiredRow = row('expired —');
    expect(expiredRow?.textContent).toContain('2 pantry items expired — clear them out');
    expiredRow!.click();
    expect(navigate).toHaveBeenLastCalledWith('/pantry');
  });

  test('the expiring-today count pluralizes and the expired row pins the singular', () => {
    const { row } = panel([
      item('p-a', 'use_today', 'Salmon'),
      item('p-b', 'use_today', 'Cream'),
      item('p-c', 'expired', 'Dill'),
    ]);
    expect(row('expiring today')?.textContent).toContain('2 items expiring today');
    expect(row('expired —')?.textContent).toContain('1 pantry item expired');
  });

  test('no use_today item, no expiring-today row', () => {
    const { row } = panel([item('p-dill', 'expired', 'Dill'), item('p-fresh', 'fresh', 'Rice')]);
    expect(row('expiring today')).toBeUndefined();
  });
});
