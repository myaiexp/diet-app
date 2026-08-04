// Ingredient catalog reads (shared by pantry add and import reconciliation)

import { apiGet } from './client.js';
import type { Ingredient } from './types.js';

export interface IngredientQuery {
  /** Substring match on name OR any alias — 'peruna' finds Potato. */
  q?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export function listIngredients(query: IngredientQuery = {}): Promise<Ingredient[]> {
  return apiGet<Ingredient[]>('/ingredients', { ...query });
}

/** Catalog search for a picker. Empty query → no request, no results. */
export async function searchIngredients(q: string, limit = 20): Promise<Ingredient[]> {
  const needle = q.trim();
  if (!needle) return [];
  return listIngredients({ q: needle, limit });
}

export function getIngredient(id: string): Promise<Ingredient> {
  return apiGet<Ingredient>(`/ingredients/${id}`);
}
