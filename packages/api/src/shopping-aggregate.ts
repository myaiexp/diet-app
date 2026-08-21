// Pure meal-plan demand vs pantry supply aggregation for shopping lists

import { toBase, baseUnit, round6, type Dimension } from './units.js';

export interface PlanEntry {
  id: string;
  recipeId: string | null;
  substituteRecipeId: string | null;
  servings: number;
  status: string; // planned | cooked | skipped | substituted
  date: string; // YYYY-MM-DD, the entry's day within the week — drives the per-day simulation below
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
  // How much of this week's demand the day-by-day simulation actually
  // consumed — not "all non-expired stock summed up". Once a lot's expiry can
  // fall mid-week, "how much do you have" has no single answer independent of
  // when it's needed, so this is capped at quantityNeeded and can read lower
  // than the raw sum of still-alive lots.
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
  quantity: number; // base units, running sum across the whole week
  byDate: Map<string, number>; // base units needed on that calendar date
}

interface Lot {
  quantity: number; // base units, mutated as the simulation consumes it
  expiresDate: string; // YYYY-MM-DD
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
      let existing = demand.get(key);
      if (!existing) {
        existing = {
          ingredientId: line.ingredientId,
          dimension: based.dimension,
          quantity: 0,
          byDate: new Map(),
        };
        demand.set(key, existing);
      }
      existing.quantity += based.value;
      existing.byDate.set(entry.date, (existing.byDate.get(entry.date) ?? 0) + based.value);
    }
  }

  // Supply only matters for keys that already have demand — a pantry row for an
  // ingredient/dimension nobody needs never spawns an item on its own. Lots are
  // kept individually, not summed, because the simulation below needs each
  // one's own expiry to decide, date by date, whether it's still usable —
  // a single pooled total can't tell a Wednesday-dead lot from a June one.
  const lots = new Map<string, Lot[]>();
  for (const row of pantryRows) {
    const based = toBase(row.quantity, row.unit);
    if (!based) continue; // unresolvable pantry unit: not demand-side, so no skip to report
    const key = `${row.ingredientId}|${based.dimension}`;
    if (!demand.has(key)) continue;
    const lot: Lot = { quantity: based.value, expiresDate: row.expiresDate };
    const existing = lots.get(key);
    if (existing) existing.push(lot);
    else lots.set(key, [lot]);
  }

  const items: GeneratedItem[] = [];
  for (const [key, d] of demand) {
    // FEFO within a date only works if lots are tried soonest-expiry-first;
    // sorting once up front is equivalent to re-sorting per date because a
    // lot's relative expiry order never changes across the walk.
    const keyLots = [...(lots.get(key) ?? [])].sort((a, b) =>
      a.expiresDate < b.expiresDate ? -1 : a.expiresDate > b.expiresDate ? 1 : 0,
    );

    let consumed = 0;
    // Walk the week's demand chronologically so a lot that dies mid-week stops
    // covering demand that falls after it — netting the whole week's demand
    // against the whole week's supply up front (the old behavior) is exactly
    // what let a Saturday meal eat a Wednesday-expired lot.
    for (const date of [...d.byDate.keys()].sort()) {
      let need = d.byDate.get(date)!;

      // A lot already dead as of today must stay dead no matter which day of
      // the current week an entry falls on — otherwise an entry dated earlier
      // in the week (already past) would "resurrect" stock that has since
      // expired. A lot still alive today is instead checked against the
      // entry's own date, so demand later in the week can still watch it
      // expire out from under it. max(entryDate, today) is exactly that rule.
      const availableFrom = date < today ? today : date;

      for (const lot of keyLots) {
        if (need <= 0) break;
        if (lot.quantity <= 0 || lot.expiresDate < availableFrom) continue;
        const take = Math.min(need, lot.quantity);
        lot.quantity -= take;
        need -= take;
        consumed += take;
      }
    }

    items.push({
      ingredientId: d.ingredientId,
      unit: baseUnit(d.dimension),
      quantityNeeded: round6(d.quantity),
      quantityInPantry: round6(consumed),
      netToBuy: round6(Math.max(0, d.quantity - consumed)),
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
