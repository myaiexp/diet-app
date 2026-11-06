// Shopping lists, items, their write bodies, and the generate/complete results
import type { ShoppingListStatus, ShoppingItemSource, SkippedGenerateReason } from '@diet-app/api/vocab';
import type { Ingredient } from './ingredients.js';
import type { PantryItem } from './pantry.js';

export interface ShoppingItem {
  id: string;
  listId: string;
  ingredientId: string;
  /** numeric columns — strings, never numbers. */
  quantityNeeded: string;
  quantityInPantry: string;
  netToBuy: string;
  category: string;
  /** Always the dimension's base unit (g | ml | pieces) — never a display unit. */
  unit: string;
  source: ShoppingItemSource;
  bought: boolean;
  customNote: string | null;
  /**
   * True once the user has changed a quantity. Regeneration will not
   * overwrite this row's quantity triple.
   */
  quantityEdited: boolean;
  /** Eager-loaded on every read, same reason as PantryItem.ingredient. */
  ingredient: Ingredient;
}

export interface ShoppingListRow {
  id: string;
  weekStarting: string;
  status: ShoppingListStatus;
  createdAt: string;
  updatedAt: string;
}

/** GET /current and GET /:id — the bare list row plus its (already sorted) items. */
export interface ShoppingList extends ShoppingListRow {
  items: ShoppingItem[];
}

export interface ShoppingItemCreate {
  ingredientId: string;
  quantityNeeded: number;
  unit: string;
  customNote?: string;
}

/** ingredientId/unit are absent on purpose — changing either moves the row
 * across the (list, ingredient, unit) unique index. Delete and re-add instead. */
export interface ShoppingItemPatch {
  bought?: boolean;
  quantityNeeded?: number;
  netToBuy?: number;
  customNote?: string | null;
}

export interface SkippedGenerateLine {
  ingredientId: string | null;
  entryId: string;
  reason: SkippedGenerateReason;
}

/**
 * POST /generate's shape, not GET /current's: `list` is the bare row and
 * `items` is a sibling array, rather than items nesting inside the list.
 */
export interface ShoppingGenerateResult {
  list: ShoppingListRow;
  items: ShoppingItem[];
  skipped: SkippedGenerateLine[];
}

export interface SkippedCompleteItem {
  itemId: string;
  reason: 'no_shelf_life';
}

/** POST /:id/complete — `list` is the bare row, now `status: 'done'`. */
export interface ShoppingCompleteResult {
  list: ShoppingListRow;
  added: PantryItem[];
  skipped: SkippedCompleteItem[];
}
