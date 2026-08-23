// Pure FEFO pantry deduction planner (recipe lines vs pantry rows)

import { toBase, fromBase, resolveUnit, round6, type Dimension } from './units.js';

export interface RecipeLine {
  ingredientId: string;
  quantity: number; // per the recipe's own base servings
  unit: string;
  optional: boolean;
}

export interface PantryRow {
  id: string;
  ingredientId: string;
  quantity: number;
  unit: string;
  expiresDate: string; // YYYY-MM-DD
  opened: boolean;
  createdAt: string; // ISO timestamp, tiebreak only
}

export interface PantryChange {
  id: string;
  unit: string; // the row's own unit, unchanged
  before: number;
  after: number; // in the row's own unit
  deleted: boolean; // after === 0
}

export interface Deduction {
  ingredientId: string;
  dimension: Dimension;
  requested: number; // base units, after scaling
  deducted: number; // base units actually taken
  pantryItems: PantryChange[];
}

export interface Shortfall {
  ingredientId: string;
  dimension: Dimension | null; // null when the recipe line's own unit is unknown
  requested: number;
  available: number;
  reason: 'not_in_pantry' | 'insufficient_stock' | 'unit_mismatch';
}

const EPSILON = 1e-9;

/** FEFO: soonest expiry → opened first → oldest createdAt → lower id. Copies input. */
function sortFefo(rows: PantryRow[]): PantryRow[] {
  return [...rows].sort((a, b) => {
    if (a.expiresDate !== b.expiresDate) {
      return a.expiresDate < b.expiresDate ? -1 : 1;
    }
    if (a.opened !== b.opened) {
      return a.opened ? -1 : 1;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1;
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  });
}

export function planDeduction(
  lines: RecipeLine[],
  pantryRows: PantryRow[],
  scale: number,
): { deductions: Deduction[]; shortfalls: Shortfall[] } {
  const deductions: Deduction[] = [];
  const shortfalls: Shortfall[] = [];

  // Working remainder per row (row's own unit); never mutates input rows.
  const remainingQty = new Map<string, number>();
  for (const row of pantryRows) {
    remainingQty.set(row.id, row.quantity);
  }

  for (const line of lines) {
    const scaled = line.quantity * scale;
    const needed = toBase(scaled, line.unit);

    if (!needed) {
      if (!line.optional) {
        shortfalls.push({
          ingredientId: line.ingredientId,
          dimension: null,
          requested: round6(scaled),
          available: 0,
          reason: 'unit_mismatch',
        });
      }
      continue;
    }

    const { dimension, value: needBase } = needed;
    const ingredientRows = pantryRows.filter((r) => r.ingredientId === line.ingredientId);
    const eligible = ingredientRows.filter((r) => {
      const info = resolveUnit(r.unit);
      return info !== null && info.dimension === dimension;
    });

    if (eligible.length === 0) {
      if (!line.optional) {
        shortfalls.push({
          ingredientId: line.ingredientId,
          dimension,
          requested: round6(needBase),
          available: 0,
          reason: ingredientRows.length === 0 ? 'not_in_pantry' : 'unit_mismatch',
        });
      }
      continue;
    }

    let remainingNeed = needBase;
    let deductedBase = 0;
    const pantryItems: PantryChange[] = [];

    for (const row of sortFefo(eligible)) {
      if (remainingNeed < EPSILON) break;

      const before = remainingQty.get(row.id) ?? 0;
      if (before < EPSILON) continue;

      const rowBase = toBase(before, row.unit);
      if (!rowBase) continue;

      const takeBase = Math.min(remainingNeed, rowBase.value);
      const leftBase = rowBase.value - takeBase;

      let after: number;
      let deleted: boolean;
      if (leftBase < EPSILON) {
        after = 0;
        deleted = true;
      } else {
        const converted = fromBase(leftBase, row.unit);
        after = converted === null ? 0 : round6(converted);
        if (after < EPSILON) {
          after = 0;
          deleted = true;
        } else {
          deleted = false;
        }
      }

      remainingQty.set(row.id, after);
      pantryItems.push({
        id: row.id,
        unit: row.unit,
        before: round6(before),
        after,
        deleted,
      });

      deductedBase += takeBase;
      remainingNeed -= takeBase;
    }

    if (deductedBase >= EPSILON) {
      deductions.push({
        ingredientId: line.ingredientId,
        dimension,
        requested: round6(needBase),
        deducted: round6(deductedBase),
        pantryItems,
      });
    }

    if (remainingNeed >= EPSILON && !line.optional) {
      shortfalls.push({
        ingredientId: line.ingredientId,
        dimension,
        requested: round6(needBase),
        available: round6(deductedBase),
        reason: 'insufficient_stock',
      });
    }
  }

  return { deductions, shortfalls };
}
