// Pantry CRUD — the list arrives spoilage-first; never re-sort it

import { apiGet, apiSend } from './client.js';
import type { PantryItem, PantryCreate, PantryPatch } from './types.js';

export interface PageQuery {
  limit?: number;
  offset?: number;
}

/**
 * Spoilage-first with an id tie-break, straight from the API. Re-sorting
 * client-side breaks paging consistency: the server pages in that exact order.
 */
export function listPantry(page: PageQuery = {}): Promise<PantryItem[]> {
  return apiGet<PantryItem[]>('/pantry', { ...page });
}

export function getPantryItem(id: string): Promise<PantryItem> {
  return apiGet<PantryItem>(`/pantry/${id}`);
}

/**
 * Omitting `expiresDate` is the normal path: the API derives it from the
 * ingredient's shelf life for that location. Don't compute one client-side.
 */
export function createPantryItem(body: PantryCreate): Promise<PantryItem> {
  return apiSend<PantryItem>('POST', '/pantry', body);
}

export function patchPantryItem(id: string, body: PantryPatch): Promise<PantryItem> {
  return apiSend<PantryItem>('PATCH', `/pantry/${id}`, body);
}

export function deletePantryItem(id: string): Promise<void> {
  return apiSend<void>('DELETE', `/pantry/${id}`);
}
