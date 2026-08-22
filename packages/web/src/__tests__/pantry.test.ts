// Pantry screen: spoilage order is never re-derived client-side, status is
// always the API's own, filtering and pagination behave, and failures surface.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { pantryScreen } from '../screens/pantry/index.js';
import type { PantryItem, Ingredient } from '../api/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeItem(overrides: Partial<PantryItem> = {}): PantryItem {
  return {
    id: 'item-1',
    ingredientId: 'ing-1',
    quantity: '400',
    unit: 'g',
    location: 'fridge',
    addedDate: '2026-08-01',
    expiresDate: '2026-08-10',
    opened: false,
    status: 'fresh',
    // Every pantry endpoint eager-loads this — the row arrives renderable.
    ingredient: makeIngredient(),
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-1',
    name: 'Milk',
    aliases: ['maito'],
    category: 'dairy',
    defaultUnit: 'l',
    nutritionPer100g: null,
    shelfLife: null,
    tags: null,
    isPantryStaple: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

function makeCtx() {
  return { setSubtitle: vi.fn(), navigate: vi.fn() };
}

function pathOf(url: string): string {
  return new URL(url, 'http://x').pathname;
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

describe('pantry screen', () => {
  test('renders rows in the order the API returned them, not alphabetical or chronological', async () => {
    // Neither A-Z ('Apple','Banana','Zucchini') nor soonest-first ('Apple' 8/1,
    // 'Banana' 8/15, 'Zucchini' 8/20) matches this order — only trusting the
    // response as-is reproduces it.
    const items = [
      makeItem({
        id: 'p-3',
        ingredientId: 'ing-c',
        expiresDate: '2026-08-20',
        ingredient: makeIngredient({ id: 'ing-c', name: 'Zucchini' }),
      }),
      makeItem({
        id: 'p-1',
        ingredientId: 'ing-a',
        expiresDate: '2026-08-01',
        ingredient: makeIngredient({ id: 'ing-a', name: 'Apple' }),
      }),
      makeItem({
        id: 'p-2',
        ingredientId: 'ing-b',
        expiresDate: '2026-08-15',
        ingredient: makeIngredient({ id: 'ing-b', name: 'Banana' }),
      }),
    ];
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/pantry') return jsonResponse(200, items);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const names = [...root.querySelectorAll('.row-title')].map((n) => n.textContent);
    expect(names).toEqual(['Zucchini', 'Apple', 'Banana']);
    // One request for the page, and none per row: the list eager-loads its
    // ingredients, so rendering N rows must never cost N lookups.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('renders the API status even when expiresDate suggests otherwise', async () => {
    // Deliberately contradictory fixture: a status of 'expired' with a
    // far-future expiresDate. A client that recomputed status from the date
    // would render this as fresh; rendering must follow `status` alone.
    const item = makeItem({ expiresDate: '2099-01-01', status: 'expired' });
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/pantry') return jsonResponse(200, [item]);
      if (path === '/api/ingredients/ing-1') return jsonResponse(200, makeIngredient());
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const row = root.querySelector<HTMLElement>('.pantry-row')!;
    expect(row.getAttribute('style') ?? '').toContain('--red');
    expect(row.querySelector('.pantry-status-line')?.textContent).toContain('expired');
  });

  test('filters by location client-side without refetching', async () => {
    const items = [
      makeItem({ id: 'p-1', ingredientId: 'ing-1', location: 'fridge' }),
      makeItem({ id: 'p-2', ingredientId: 'ing-2', location: 'freezer' }),
      makeItem({ id: 'p-3', ingredientId: 'ing-3', location: 'pantry' }),
    ];
    const byId: Record<string, Ingredient> = {
      'ing-1': makeIngredient({ id: 'ing-1', name: 'Milk' }),
      'ing-2': makeIngredient({ id: 'ing-2', name: 'Peas' }),
      'ing-3': makeIngredient({ id: 'ing-3', name: 'Rice' }),
    };
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/pantry') return jsonResponse(200, items);
      const m = /^\/api\/ingredients\/(.+)$/.exec(path);
      if (m) return jsonResponse(200, byId[m[1]!]);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const before = fetchMock.mock.calls.length;
    const fridgeChip = [...root.querySelectorAll<HTMLElement>('.chip')].find((c) =>
      c.textContent?.startsWith('fridge'),
    )!;
    fridgeChip.click();

    expect(fetchMock.mock.calls.length).toBe(before);
    const names = [...root.querySelectorAll('.row-title')].map((n) => n.textContent);
    expect(names).toEqual(['Milk']);
  });

  test('searches ingredients by Finnish alias', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/pantry') return jsonResponse(200, []);
      if (path === '/api/ingredients') {
        expect(new URL(url, 'http://x').searchParams.get('q')).toBe('peruna');
        return jsonResponse(200, [
          makeIngredient({
            id: 'ing-potato',
            name: 'Potato',
            aliases: ['peruna'],
            category: 'produce',
            defaultUnit: 'kg',
          }),
        ]);
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const input = root.querySelector<HTMLInputElement>('.pantry-search-wrap input')!;
    input.value = 'peruna';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(250);

    const calls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => pathOf(u) === '/api/ingredients' && u.includes('q=peruna'))).toBe(
      true,
    );
    const results = [...root.querySelectorAll('.pantry-search-result')];
    expect(results.some((r) => r.textContent?.includes('Potato'))).toBe(true);
  });

  test('shows the API error message when create fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/pantry' && method === 'GET') return jsonResponse(200, []);
      if (path === '/api/ingredients') {
        return jsonResponse(200, [
          makeIngredient({ id: 'ing-x', name: 'Xylitol', aliases: [], defaultUnit: 'g' }),
        ]);
      }
      if (path === '/api/pantry' && method === 'POST') {
        return jsonResponse(400, { error: 'Invalid reference' });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const input = root.querySelector<HTMLInputElement>('.pantry-search-wrap input')!;
    input.value = 'xyl';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(250);

    document.querySelector<HTMLElement>('.pantry-search-result')!.click();
    document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
    await flush(50);

    expect(document.querySelector('.helper-error')?.textContent).toContain('Invalid reference');
    // A generic 400 is not the no-shelf-life signal — the date field stays hidden
    // so a retry still omits expiresDate (the dedicated fallback lives in pantry-form.test.ts).
    const expires = document.querySelector<HTMLInputElement>('.pantry-form input[type="date"]');
    expect(expires?.closest('.pantry-field')?.classList.contains('hidden')).toBe(true);
  });

  test('loads the next page when the list hits the default 50-item limit', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id: `p-${i}`, expiresDate: `2026-08-${String((i % 27) + 1).padStart(2, '0')}` }),
    );
    const page2 = [makeItem({ id: 'p-50', expiresDate: '2026-09-01' })];
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/pantry') {
        const offset = new URL(url, 'http://x').searchParams.get('offset') ?? '0';
        return jsonResponse(200, offset === '0' ? page1 : page2);
      }
      if (path === '/api/ingredients/ing-1') return jsonResponse(200, makeIngredient());
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const loadMoreBtn = [...root.querySelectorAll<HTMLElement>('.pantry-tail .btn')].find(
      (b) => b.textContent === 'load more',
    );
    expect(loadMoreBtn).toBeTruthy();
    loadMoreBtn!.click();
    await flush(50);

    const pantryCalls = fetchMock.mock.calls
      .map((c) => c[0] as string)
      .filter((u) => pathOf(u) === '/api/pantry');
    expect(pantryCalls.length).toBeGreaterThanOrEqual(2);
    expect(pantryCalls[1]).toContain('offset=50');
  });

  test('renders an empty state when the pantry has no items', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/pantry') return jsonResponse(200, []);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const empty = root.querySelector('.empty-state');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toMatch(/empty/i);
  });
});
