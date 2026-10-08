// Shared recipe-line shape, which recipe an entry uses, and the servings scale

import { parseServings } from './servings.js';

export interface RecipeLine {
  ingredientId: string;
  quantity: number; // per the recipe's own base servings, before servingsScale
  unit: string;
  optional: boolean;
}

export function toRecipeLine(row: {
  ingredientId: string;
  quantity: unknown;
  unit: string;
  optional?: boolean | null;
}): RecipeLine {
  return {
    ingredientId: row.ingredientId,
    quantity: Number(row.quantity),
    unit: row.unit,
    optional: row.optional ?? false,
  };
}

/** substituteRecipeId wins. Null when the entry is a freeform note. */
export function resolvedRecipeId(entry: {
  recipeId: string | null;
  substituteRecipeId: string | null;
}): string | null {
  return entry.substituteRecipeId ?? entry.recipeId;
}

/** A positive finite number. Zero, negatives, NaN and non-numeric values are null. */
export function positiveFinite(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

/**
 * target/base when `target` is a legal servings count (1–12) and `base` is
 * positive finite. Null otherwise: a zero or negative recipe base must not
 * scale a deduction or a shopping demand.
 */
export function servingsScale(target: unknown, base: unknown): number | null {
  const t = parseServings(target);
  const b = positiveFinite(base);
  if (t === null || b === null) return null;
  const scale = t / b;
  return Number.isFinite(scale) ? scale : null;
}
