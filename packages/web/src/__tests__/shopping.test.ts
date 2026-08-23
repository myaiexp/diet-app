// Shopping screen: aisle grouping order (and that within-group server order
// survives grouping), first-run/empty states, bought toggle with optimistic
// revert, a done list rendering read-only, the three pantry-arithmetic
// phrasings, and the generate-skipped notice. Mirrors pantry.test.ts's
// fixture/mock style.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { shoppingScreen } from '../screens/shopping/index.js';
import { groupByAisle, pantryLine } from '../screens/shopping/groups.js';
import { flush, jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeIngredient, makeShoppingItem, makeShoppingList } from './fixtures.js';

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
    // 'c' is a pantry staple the server already sunk to the bottom of
    // 'produce' — grouping must not re-sort it back up.
    const items = [
      makeShoppingItem({ id: 'a', category: 'dairy' }),
      makeShoppingItem({ id: 'b', category: 'produce' }),
      makeShoppingItem({ id: 'c', category: 'produce', ingredient: makeIngredient({ isPantryStaple: true }) }),
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
    await flush(20);

    const patchCall = fetchMock.mock.calls.find(
      (c) =>
        pathOf(c[0] as string) === '/api/shopping-lists/items/item-1' &&
        (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({ bought: true });

    // Reverted after the 500 — the row is no longer marked checked.
    const rowAfter = root.querySelector<HTMLElement>('.shopping-row')!;
    expect(rowAfter.classList.contains('is-checked')).toBe(false);
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
    expect(root.querySelector('.shopping-more-btn')).toBeNull();

    const before = fetchMock.mock.calls.length;
    root.querySelector<HTMLElement>('.shopping-row-toggle')!.click();
    await flush(20);

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  test('generate surfaces a non-empty skipped array as a dismissible notice', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': jsonResponse(404, { error: 'Not found' }),
          'POST /api/shopping-lists/generate': {
            list: {
              id: 'list-9',
              weekStarting: '2026-08-17',
              status: 'draft',
              createdAt: '2026-08-17T00:00:00.000Z',
              updatedAt: '2026-08-17T00:00:00.000Z',
            },
            items: [makeShoppingItem({ id: 'item-1' })],
            skipped: [{ ingredientId: null, entryId: 'entry-1', reason: 'unknown_unit' }],
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.empty-state .btn-primary')!.click();
    await flush(20);

    expect(root.querySelector('.shopping-notice')).not.toBeNull();
    expect(root.textContent).toMatch(/skipped/i);
    expect(root.textContent).toMatch(/unknown unit/i);
  });

  test('the include-optional chip sends includeOptional on the next generate', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({ items: [makeShoppingItem()] }),
          'POST /api/shopping-lists/generate': {
            list: makeShoppingList(),
            items: [makeShoppingItem()],
            skipped: [],
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    const chip = [...root.querySelectorAll<HTMLElement>('.chip')].find(
      (c) => c.textContent === 'include optional',
    )!;
    // Off by default — the API's own default, and the one the design settled on.
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    chip.click();

    const regenerate = [...root.querySelectorAll<HTMLElement>('.shopping-actions .btn')].find(
      (b) => b.textContent === 'regenerate',
    )!;
    regenerate.click();
    await flush(20);

    const generateCall = fetchMock.mock.calls.find(
      (c) => pathOf(c[0] as string) === '/api/shopping-lists/generate',
    )!;
    expect(JSON.parse((generateCall[1] as RequestInit).body as string)).toEqual({
      weekStarting: '2026-08-17',
      includeOptional: true,
    });
  });

  test('deleting a generated row warns that regeneration brings it back', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            items: [makeShoppingItem({ source: 'generated' })],
          }),
          'DELETE /api/shopping-lists/items/:id': new Response(null, { status: 204 }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    root.querySelector<HTMLElement>('.shopping-more-btn')!.click();
    await flush(20);

    // The reappearance is deliberate API behaviour (#3232, dismissed): the
    // toast is the only place the user could learn it.
    expect(document.querySelector('.toast')?.textContent).toMatch(/bring it back/i);
  });

  test('a completion that skipped items says they did NOT reach the pantry', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            status: 'shopping',
            items: [makeShoppingItem({ bought: true })],
          }),
          'POST /api/shopping-lists/:id/complete': {
            list: { ...makeShoppingList(), status: 'done' },
            added: [],
            skipped: [{ itemId: 'item-1', reason: 'no_shelf_life' }],
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    [...root.querySelectorAll<HTMLElement>('.shopping-actions .btn')]
      .find((b) => b.textContent === 'complete')!
      .click();
    document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
    await flush(20);

    // A skipped item was NOT written to the pantry — copy that implied it was
    // would send the user hunting for food that isn't there.
    const notice = root.querySelector('.shopping-notice')?.textContent ?? '';
    expect(notice).toMatch(/did not reach the pantry/i);
    expect(notice).not.toMatch(/were filed/i);
  });
});
