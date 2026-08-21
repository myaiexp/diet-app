// Shopping list reads + writes: current-week list, generation, item CRUD, complete hand-off

import { apiGet, apiSend } from './client.js';
import type {
  ShoppingList,
  ShoppingItem,
  ShoppingItemCreate,
  ShoppingItemPatch,
  ShoppingGenerateResult,
  ShoppingCompleteResult,
} from './types.js';

/** The list whose week most recently started (week_starting <= today). 404 when none exists. */
export function getCurrentShoppingList(): Promise<ShoppingList> {
  return apiGet<ShoppingList>('/shopping-lists/current');
}

/**
 * `weekStarting` is any date in the target week — the API snaps it to the ISO
 * Monday. `includeOptional` opts the recipes' optional lines into the week's
 * demand; it is per-generation and never persisted on the list, so it has to be
 * re-sent on every regenerate that wants it.
 */
export function generateShoppingList(
  weekStarting: string,
  includeOptional = false,
): Promise<ShoppingGenerateResult> {
  return apiSend<ShoppingGenerateResult>('POST', '/shopping-lists/generate', {
    weekStarting,
    includeOptional,
  });
}

/** The server normalizes unit + quantity to the dimension base before writing. */
export function addShoppingItem(listId: string, body: ShoppingItemCreate): Promise<ShoppingItem> {
  return apiSend<ShoppingItem>('POST', `/shopping-lists/${listId}/items`, body);
}

/** Path shape is /shopping-lists/items/:id — not nested under the list id. */
export function patchShoppingItem(itemId: string, body: ShoppingItemPatch): Promise<ShoppingItem> {
  return apiSend<ShoppingItem>('PATCH', `/shopping-lists/items/${itemId}`, body);
}

export function deleteShoppingItem(itemId: string): Promise<void> {
  return apiSend<void>('DELETE', `/shopping-lists/items/${itemId}`);
}

/**
 * Files every bought && netToBuy>0 item into the pantry and marks the list
 * done — terminal, same as cook on a meal plan entry. The body must be `{}`;
 * the API 400s a bodyless request like every other write route here.
 */
export function completeShoppingList(listId: string): Promise<ShoppingCompleteResult> {
  return apiSend<ShoppingCompleteResult>('POST', `/shopping-lists/${listId}/complete`, {});
}
