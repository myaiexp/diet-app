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
import type { ShoppingItem, ShoppingList, Ingredient } from '../api/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pathOf(url: string): string {
  return new URL(url, 'http://x').pathname;
}

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

function makeCtx() {
  return { setSubtitle: vi.fn(), navigate: vi.fn(), isStale: () => false };
}

function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-1',
    name: 'Leek',
    aliases: ['purjo'],
    category: 'produce',
    defaultUnit: 'pieces',
    nutritionPer100g: null,
    shelfLife: null,
    tags: null,
    isPantryStaple: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: 'item-1',
    listId: 'list-1',
    ingredientId: 'ing-1',
    quantityNeeded: '400',
    quantityInPantry: '0',
    netToBuy: '400',
    category: 'produce',
    unit: 'g',
    source: 'generated',
    bought: false,
    customNote: null,
    ingredient: makeIngredient(),
    ...overrides,
  };
}

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: 'list-1',
    weekStarting: '2026-08-17',
    status: 'draft',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    items: [],
    ...overrides,
  };
}

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
      makeItem({ id: 'a', category: 'dairy' }),
      makeItem({ id: 'b', category: 'produce' }),
      makeItem({ id: 'c', category: 'produce', ingredient: makeIngredient({ isPantryStaple: true }) }),
      makeItem({ id: 'd', category: 'protein' }),
    ];

    const groups = groupByAisle(items);

    expect(groups.map((g) => g.category)).toEqual(['produce', 'protein', 'dairy']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  test('appends a category outside the named aisle order, in first-seen order', () => {
    const items = [
      makeItem({ id: 'a', category: 'produce' }),
      makeItem({ id: 'b', category: 'frozen' }),
      makeItem({ id: 'c', category: 'frozen' }),
    ];

    const groups = groupByAisle(items);

    expect(groups.map((g) => g.category)).toEqual(['produce', 'frozen']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['b', 'c']);
  });
});

describe('pantryLine (pure)', () => {
  test('nothing in the pantry', () => {
    expect(pantryLine(makeItem({ quantityInPantry: '0', netToBuy: '400' }))).toBe(
      'nothing in the pantry',
    );
  });

  test('fully covered by the pantry', () => {
    expect(pantryLine(makeItem({ quantityInPantry: '400', netToBuy: '0' }))).toBe(
      'covered by the pantry',
    );
  });

  test('partial coverage names both amounts', () => {
    expect(
      pantryLine(makeItem({ quantityInPantry: '200', netToBuy: '200', unit: 'g' })),
    ).toBe('pantry covers 200 g · 200 g short');
  });
});

describe('shopping screen', () => {
  test('renders the first-run state on a 404', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (pathOf(url) === '/api/shopping-lists/current') {
        return jsonResponse(404, { error: 'Not found' });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    expect(root.querySelector('.empty-state')).not.toBeNull();
    expect(root.textContent).toMatch(/generate this week's list/i);
  });

  test('renders the empty state on a 200 with zero items', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (pathOf(url) === '/api/shopping-lists/current') {
        return jsonResponse(200, makeList({ items: [] }));
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    expect(root.textContent).toMatch(/nothing to buy/i);
    expect(root.querySelector('.empty-state')).not.toBeNull();
  });

  test('toggling a row PATCHes bought:true and reverts it on a failure response', async () => {
    const item = makeItem({ id: 'item-1', bought: false });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/shopping-lists/current' && method === 'GET') {
        return jsonResponse(200, makeList({ items: [item] }));
      }
      if (path === '/api/shopping-lists/items/item-1' && method === 'PATCH') {
        return jsonResponse(500, { error: 'boom' });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

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
    const item = makeItem({ id: 'item-1', bought: true });
    fetchMock.mockImplementation(async (url: string) => {
      if (pathOf(url) === '/api/shopping-lists/current') {
        return jsonResponse(200, makeList({ status: 'done', items: [item] }));
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/shopping-lists/current' && method === 'GET') {
        return jsonResponse(404, { error: 'Not found' });
      }
      if (path === '/api/shopping-lists/generate' && method === 'POST') {
        return jsonResponse(200, {
          list: {
            id: 'list-9',
            weekStarting: '2026-08-17',
            status: 'draft',
            createdAt: '2026-08-17T00:00:00.000Z',
            updatedAt: '2026-08-17T00:00:00.000Z',
          },
          items: [makeItem({ id: 'item-1' })],
          skipped: [{ ingredientId: null, entryId: 'entry-1', reason: 'unknown_unit' }],
        });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.empty-state .btn-primary')!.click();
    await flush(20);

    expect(root.querySelector('.shopping-notice')).not.toBeNull();
    expect(root.textContent).toMatch(/skipped/i);
    expect(root.textContent).toMatch(/unknown unit/i);
  });

  test('the include-optional chip sends includeOptional on the next generate', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/shopping-lists/current' && method === 'GET') {
        return jsonResponse(200, makeList({ items: [makeItem()] }));
      }
      if (path === '/api/shopping-lists/generate' && method === 'POST') {
        return jsonResponse(200, {
          list: makeList(),
          items: [makeItem()],
          skipped: [],
        });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/shopping-lists/current' && method === 'GET') {
        return jsonResponse(200, makeList({ items: [makeItem({ source: 'generated' })] }));
      }
      if (path === '/api/shopping-lists/items/item-1' && method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    root.querySelector<HTMLElement>('.shopping-more-btn')!.click();
    await flush(20);

    // The reappearance is deliberate API behaviour (#3232, dismissed): the
    // toast is the only place the user could learn it.
    expect(document.querySelector('.toast')?.textContent).toMatch(/bring it back/i);
  });

  test('a completion that skipped items says they did NOT reach the pantry', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/shopping-lists/current' && method === 'GET') {
        return jsonResponse(200, makeList({ items: [makeItem({ bought: true })] }));
      }
      if (path === '/api/shopping-lists/list-1/complete' && method === 'POST') {
        return jsonResponse(200, {
          list: { ...makeList(), status: 'done' },
          added: [],
          skipped: [{ itemId: 'item-1', reason: 'no_shelf_life' }],
        });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

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
