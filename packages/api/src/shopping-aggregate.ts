// Pure meal-plan demand vs pantry supply aggregation for shopping lists

import { toBase, baseUnit, round6, type Dimension } from './units.js';

export interface PlanEntry {
  id: string;
  recipeId: string | null;
  substituteRecipeId: string | null;
  servings: number;
  status: string; // planned | cooked | skipped | substituted
}

export interface AggregateRecipeLine {
  ingredientId: string;
  quantity: number;
  unit: string;
  optional: boolean;
}

export interface PantrySupplyRow {
  ingredientId: string;
  quantity: number;
  unit: string;
  expiresDate: string; // YYYY-MM-DD
}

export interface GeneratedItem {
  ingredientId: string;
  unit: string; // base unit for the dimension
  quantityNeeded: number;
  quantityInPantry: number;
  netToBuy: number;
  category: string;
}

export interface SkippedLine {
  ingredientId: string | null; // null when the whole entry was unusable
  entryId: string;
  reason: 'unknown_unit' | 'recipe_missing' | 'bad_scale';
}

// cooked is already made (and already deducted from the pantry); skipped never
// happened. Only these two statuses still need buying.
const DEMAND_STATUSES = new Set(['planned', 'substituted']);

interface DemandEntry {
  ingredientId: string;
  dimension: Dimension;
  quantity: number; // base units, running sum
}

export function aggregateShoppingList(input: {
  entries: PlanEntry[];
  recipesById: Map<string, { servings: number }>;
  linesByRecipe: Map<string, AggregateRecipeLine[]>;
  pantryRows: PantrySupplyRow[];
  ingredientsById: Map<string, { category: string }>;
  today: string;
}): { items: GeneratedItem[]; skipped: SkippedLine[] } {
  const { entries, recipesById, linesByRecipe, pantryRows, ingredientsById, today } = input;

  // Keyed on ingredientId+dimension, never ingredientId alone: mass/volume/count
  // can't merge (units.ts has no density data to cross them), so the same
  // ingredient can legitimately produce two rows.
  const demand = new Map<string, DemandEntry>();
  const skipped: SkippedLine[] = [];

  for (const entry of entries) {
    if (!DEMAND_STATUSES.has(entry.status)) continue;

    const recipeId = entry.substituteRecipeId ?? entry.recipeId;
    if (!recipeId) continue; // freeform note only — nothing to buy, not an error

    const recipe = recipesById.get(recipeId);
    if (!recipe) {
      skipped.push({ ingredientId: null, entryId: entry.id, reason: 'recipe_missing' });
      continue;
    }

    // recipe.servings === 0 (or entry.servings === 0 too, giving NaN) can't scale.
    const scale = entry.servings / recipe.servings;
    if (!Number.isFinite(scale)) {
      skipped.push({ ingredientId: null, entryId: entry.id, reason: 'bad_scale' });
      continue;
    }

    const lines = linesByRecipe.get(recipeId) ?? []; // recipe with no lines is not an error
    for (const line of lines) {
      if (line.optional) continue; // an optional garnish shouldn't send anyone to the shop

      const based = toBase(line.quantity * scale, line.unit);
      if (!based) {
        skipped.push({ ingredientId: line.ingredientId, entryId: entry.id, reason: 'unknown_unit' });
        continue;
      }

      const key = `${line.ingredientId}|${based.dimension}`;
      const existing = demand.get(key);
      if (existing) {
        existing.quantity += based.value;
      } else {
        demand.set(key, {
          ingredientId: line.ingredientId,
          dimension: based.dimension,
          quantity: based.value,
        });
      }
    }
  }

  // Supply only matters for keys that already have demand — a pantry row for an
  // ingredient/dimension nobody needs never spawns an item on its own.
  const supply = new Map<string, number>();
  for (const row of pantryRows) {
    if (row.expiresDate < today) continue; // already spoiled by today; would under-buy if counted
    const based = toBase(row.quantity, row.unit);
    if (!based) continue; // unresolvable pantry unit: not demand-side, so no skip to report
    const key = `${row.ingredientId}|${based.dimension}`;
    if (!demand.has(key)) continue;
    supply.set(key, (supply.get(key) ?? 0) + based.value);
  }

  const items: GeneratedItem[] = [];
  for (const [key, d] of demand) {
    const inPantry = supply.get(key) ?? 0;
    items.push({
      ingredientId: d.ingredientId,
      unit: baseUnit(d.dimension),
      quantityNeeded: round6(d.quantity),
      quantityInPantry: round6(inPantry),
      netToBuy: round6(Math.max(0, d.quantity - inPantry)),
      category: ingredientsById.get(d.ingredientId)?.category ?? 'other',
    });
  }

  // Map insertion order isn't a contract; sort explicitly so identical input
  // always produces identical output regardless of entry/line iteration order.
  items.sort((a, b) => {
    if (a.ingredientId !== b.ingredientId) return a.ingredientId < b.ingredientId ? -1 : 1;
    return a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0;
  });

  return { items, skipped };
}
