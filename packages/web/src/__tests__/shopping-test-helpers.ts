// Row builder and complete-flow click helpers for the shopping suites

import { makeShoppingList } from './fixtures.js';
import type { ShoppingListRow } from '../api/types.js';

/** Complete's `list` is the bare row — spreading a full list would wipe items. */
export function completedRow(): ShoppingListRow {
  const list = makeShoppingList({ status: 'done' });
  return {
    id: list.id,
    weekStarting: list.weekStarting,
    status: list.status,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

export function clickComplete(root: HTMLElement): void {
  [...root.querySelectorAll<HTMLButtonElement>('.shopping-actions .btn')]
    .find((b) => b.textContent === 'complete')!
    .click();
}

export function confirmComplete(): void {
  document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
}
