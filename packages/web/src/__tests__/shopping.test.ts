// Shopping screen: aisle groups, pantry line, empty states, bought, done list

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { shoppingScreen } from '../screens/shopping/index.js';
import { groupByAisle, pantryLine } from '../screens/shopping/groups.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeIngredient, makeShoppingItem, makeShoppingList } from './fixtures.js';
import './pin-fixture-week.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  closeModal();
  resetClient();
});

describe('groupByAisle (pure)', () => {
  test('buckets into aisle order and keeps server order inside each bucket', () => {
    // 'c' is a staple the server already sunk to the bottom of
    // 'produce' — grouping must not re-sort it back up.
    const items = [
      makeShoppingItem({ id: 'a', category: 'dairy' }),
      makeShoppingItem({ id: 'b', category: 'produce' }),
      makeShoppingItem({ id: 'c', category: 'produce', ingredient: makeIngredient({ isStaple: true }) }),
      makeShoppingItem({ id: 'd', category: 'protein' }),
    ];

    const groups = groupByAisle(items);

    expect(groups.map((g) => g.category)).toEqual(['produce', 'protein', 'dairy']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  test('appends a category outside the named aisle order, in first-seen order', () => {
    const items = [
      makeShoppingItem({ id: 'a', category: 'produce' }),
      makeShoppingItem({ id: 'b', category: 'frozen' }),
      makeShoppingItem({ id: 'c', category: 'frozen' }),
    ];

    const groups = groupByAisle(items);

    expect(groups.map((g) => g.category)).toEqual(['produce', 'frozen']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['b', 'c']);
  });
});

describe('pantryLine (pure)', () => {
  test('nothing in the pantry', () => {
    expect(pantryLine(makeShoppingItem({ quantityInPantry: '0', netToBuy: '400' }))).toBe(
      'nothing in the pantry',
    );
  });

  test('fully covered by the pantry', () => {
    expect(pantryLine(makeShoppingItem({ quantityInPantry: '400', netToBuy: '0' }))).toBe(
      'covered by the pantry',
    );
  });

  test('partial coverage names both amounts', () => {
    expect(
      pantryLine(makeShoppingItem({ quantityInPantry: '200', netToBuy: '200', unit: 'g' })),
    ).toBe('pantry covers 200 g · 200 g short');
  });
});

describe('shopping screen', () => {
  test('renders the first-run state on a 404', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        { 'GET /api/shopping-lists/current': jsonResponse(404, { error: 'Not found' }) },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    expect(root.querySelector('.empty-state')).not.toBeNull();
    expect(root.textContent).toMatch(/generate this week's list/i);
  });

  test('renders the empty state on a 200 with zero items', async () => {
    fetchMock.mockImplementation(
      routeFetch({ 'GET /api/shopping-lists/current': makeShoppingList({ items: [] }) }, { unmatched: '404' }),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    expect(root.textContent).toMatch(/nothing to buy/i);
    expect(root.querySelector('.empty-state')).not.toBeNull();
  });

  test('toggling a row PATCHes bought:true and reverts it on a failure response', async () => {
    const item = makeShoppingItem({ id: 'item-1', bought: false });
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({ items: [item] }),
          'PATCH /api/shopping-lists/items/:id': jsonResponse(500, { error: 'boom' }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    root.querySelector<HTMLElement>('.shopping-row-toggle')!.click();

    await vi.waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) =>
          pathOf(c[0] as string) === '/api/shopping-lists/items/item-1' &&
          (c[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({ bought: true });
      // Reverted after the 500 — the row is no longer marked checked.
      expect(root.querySelector('.shopping-row')!.classList.contains('is-checked')).toBe(false);
    });
  });

  test('a done list renders read-only — no PATCH fires on a row click', async () => {
    const item = makeShoppingItem({ id: 'item-1', bought: true });
    fetchMock.mockImplementation(
      routeFetch(
        { 'GET /api/shopping-lists/current': makeShoppingList({ status: 'done', items: [item] }) },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    // Read-only: the toggle surface is a plain div, not a button, and there
    // is no delete control.
    expect(root.querySelector('.shopping-row-toggle')?.tagName).toBe('DIV');
    expect(root.querySelector('.shopping-remove-btn')).toBeNull();

    const before = fetchMock.mock.calls.length;
    root.querySelector<HTMLElement>('.shopping-row-toggle')!.click();

    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
