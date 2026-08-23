// FEFO pantry deduction planner coverage

import { describe, test, expect } from 'vitest';
import {
  planDeduction,
  type PantryRow,
  type RecipeLine,
} from '../cook-deduct.js';

const ROW = (over: Partial<PantryRow> = {}): PantryRow => ({
  id: 'p1',
  ingredientId: 'i1',
  quantity: 1000,
  unit: 'g',
  expiresDate: '2026-08-01',
  opened: false,
  createdAt: '2026-07-01T00:00:00Z',
  ...over,
});

const LINE = (over: Partial<RecipeLine> = {}): RecipeLine => ({
  ingredientId: 'i1',
  quantity: 500,
  unit: 'g',
  optional: false,
  ...over,
});

describe('planDeduction', () => {
  test('deducts an exact match from a single row', () => {
    const { deductions, shortfalls } = planDeduction([LINE()], [ROW()], 1);
    expect(shortfalls).toEqual([]);
    expect(deductions[0]!.deducted).toBe(500);
    expect(deductions[0]!.pantryItems).toEqual([
      { id: 'p1', unit: 'g', before: 1000, after: 500, deleted: false },
    ]);
  });

  test('converts across units within a dimension', () => {
    // recipe wants 500 g; pantry holds 1 kg → 0.5 kg left, still stored in kg
    const { deductions } = planDeduction([LINE()], [ROW({ quantity: 1, unit: 'kg' })], 1);
    expect(deductions[0]!.pantryItems[0]).toEqual({
      id: 'p1',
      unit: 'kg',
      before: 1,
      after: 0.5,
      deleted: false,
    });
  });

  test('consumes soonest-expiring rows first (FEFO)', () => {
    const rows = [
      ROW({ id: 'later', quantity: 400, expiresDate: '2026-09-01' }),
      ROW({ id: 'sooner', quantity: 400, expiresDate: '2026-07-25' }),
    ];
    const { deductions } = planDeduction([LINE()], rows, 1);
    const touched = deductions[0]!.pantryItems;
    expect(touched[0]!.id).toBe('sooner');
    expect(touched[0]).toMatchObject({ after: 0, deleted: true });
    expect(touched[1]).toMatchObject({ id: 'later', after: 300, deleted: false });
  });

  test('prefers opened rows when expiry ties', () => {
    const rows = [
      ROW({ id: 'sealed', quantity: 600, opened: false }),
      ROW({ id: 'open', quantity: 600, opened: true }),
    ];
    const { deductions } = planDeduction([LINE()], rows, 1);
    expect(deductions[0]!.pantryItems[0]!.id).toBe('open');
  });

  test('scales the requirement by servings', () => {
    const half = planDeduction([LINE()], [ROW()], 0.5);
    expect(half.deductions[0]!.deducted).toBe(250);
    const double = planDeduction([LINE()], [ROW()], 2);
    expect(double.deductions[0]!.deducted).toBe(1000);
    expect(double.deductions[0]!.pantryItems[0]).toMatchObject({ after: 0, deleted: true });
  });

  test('reports insufficient_stock and still deducts what exists', () => {
    const { deductions, shortfalls } = planDeduction([LINE()], [ROW({ quantity: 200 })], 1);
    expect(deductions[0]!.deducted).toBe(200);
    expect(shortfalls).toEqual([
      {
        ingredientId: 'i1',
        dimension: 'mass',
        requested: 500,
        available: 200,
        reason: 'insufficient_stock',
      },
    ]);
  });

  test('reports not_in_pantry when the ingredient has no rows', () => {
    const { deductions, shortfalls } = planDeduction([LINE()], [], 1);
    expect(deductions).toEqual([]);
    expect(shortfalls[0]).toMatchObject({ reason: 'not_in_pantry', available: 0 });
  });

  test('never deducts across dimensions', () => {
    // recipe wants 500 g; the only stock is 3 pieces → no deduction at all
    const { deductions, shortfalls } = planDeduction(
      [LINE()],
      [ROW({ quantity: 3, unit: 'pcs' })],
      1,
    );
    expect(deductions).toEqual([]);
    expect(shortfalls[0]).toMatchObject({ reason: 'unit_mismatch' });
  });

  test('reports unit_mismatch with a null dimension for an unknown recipe unit', () => {
    const { shortfalls } = planDeduction([LINE({ unit: 'handful' })], [ROW()], 1);
    expect(shortfalls[0]).toMatchObject({ reason: 'unit_mismatch', dimension: null });
  });

  test('does not treat a pantry row with an unknown unit as covering gram demand', () => {
    const { deductions, shortfalls } = planDeduction(
      [LINE()],
      [ROW({ quantity: 999, unit: 'handful' })],
      1,
    );
    expect(deductions).toEqual([]);
    expect(shortfalls[0]).toMatchObject({ reason: 'unit_mismatch', available: 0 });
  });

  test('optional lines deduct what is there and never report a shortfall', () => {
    const line = LINE({ optional: true });
    const short = planDeduction([line], [ROW({ quantity: 100 })], 1);
    expect(short.deductions[0]!.deducted).toBe(100);
    expect(short.shortfalls).toEqual([]);
    const absent = planDeduction([line], [], 1);
    expect(absent.shortfalls).toEqual([]);
    expect(absent.deductions).toEqual([]); // nothing taken → no Deduction either
  });

  test('treats float residue below epsilon as fully consumed', () => {
    // 0.1 + 0.2 style residue must not leave a 1e-17 row behind
    const { deductions } = planDeduction(
      [LINE({ quantity: 0.3 })],
      [ROW({ quantity: 0.3 })],
      1,
    );
    expect(deductions[0]!.pantryItems[0]).toMatchObject({ after: 0, deleted: true });
  });

  test('handles multiple lines independently', () => {
    const lines = [LINE(), LINE({ ingredientId: 'i2', quantity: 2, unit: 'dl' })];
    const rows = [ROW(), ROW({ id: 'p2', ingredientId: 'i2', quantity: 1, unit: 'l' })];
    const { deductions, shortfalls } = planDeduction(lines, rows, 1);
    expect(shortfalls).toEqual([]);
    expect(deductions).toHaveLength(2);
    expect(deductions[1]!.pantryItems[0]).toMatchObject({ unit: 'l', after: 0.8 });
  });

  test('shares depleted stock across two lines of the same ingredient', () => {
    // 400 + 400 g needed vs 600 g stock — second line must see residual only
    const lines = [
      LINE({ quantity: 400 }),
      LINE({ quantity: 400 }),
    ];
    const { deductions, shortfalls } = planDeduction(lines, [ROW({ quantity: 600 })], 1);
    expect(deductions).toHaveLength(2);
    expect(deductions[0]!.deducted).toBe(400);
    expect(deductions[0]!.pantryItems[0]).toMatchObject({ after: 200, deleted: false });
    expect(deductions[1]!.deducted).toBe(200);
    expect(deductions[1]!.pantryItems[0]).toMatchObject({ before: 200, after: 0, deleted: true });
    expect(shortfalls).toEqual([
      {
        ingredientId: 'i1',
        dimension: 'mass',
        requested: 400,
        available: 200,
        reason: 'insufficient_stock',
      },
    ]);
  });

  test('prefers older createdAt when expiry and opened tie', () => {
    const rows = [
      ROW({ id: 'newer', quantity: 600, createdAt: '2026-07-10T00:00:00Z' }),
      ROW({ id: 'older', quantity: 600, createdAt: '2026-07-01T00:00:00Z' }),
    ];
    const { deductions } = planDeduction([LINE()], rows, 1);
    expect(deductions[0]!.pantryItems[0]!.id).toBe('older');
  });

  // Input is reverse id-order on purpose: a stable sort that returns 0 on a
  // full FEFO tie would keep 'p-z' first. Lower id is the explicit fourth key.
  test('breaks a full FEFO tie by id (lower id first)', () => {
    const rows = [
      ROW({ id: 'p-z', quantity: 400 }),
      ROW({ id: 'p-a', quantity: 400 }),
    ];
    const { deductions } = planDeduction([LINE()], rows, 1);
    const touched = deductions[0]!.pantryItems;
    expect(touched[0]!.id).toBe('p-a');
    expect(touched[0]).toMatchObject({ after: 0, deleted: true });
    expect(touched[1]).toMatchObject({ id: 'p-z', after: 300, deleted: false });
  });

  test('ignores unknown-dimension pantry rows when a matching lot exists', () => {
    // recipe 500 g; 400 g is usable, 3 handfuls must not poison eligibility.
    const rows = [
      ROW({ id: 'grams', quantity: 400, unit: 'g' }),
      ROW({ id: 'handfuls', quantity: 3, unit: 'handful' }),
    ];
    const { deductions, shortfalls } = planDeduction([LINE()], rows, 1);
    expect(deductions[0]!.deducted).toBe(400);
    expect(deductions[0]!.pantryItems).toEqual([
      { id: 'grams', unit: 'g', before: 400, after: 0, deleted: true },
    ]);
    expect(shortfalls).toEqual([
      {
        ingredientId: 'i1',
        dimension: 'mass',
        requested: 500,
        available: 400,
        reason: 'insufficient_stock',
      },
    ]);
  });
});
