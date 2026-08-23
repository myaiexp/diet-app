// Pantry screen: spoilage order is never re-derived client-side, status is
// always the API's own, filtering and pagination behave, and failures surface.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { pantryScreen } from '../screens/pantry/index.js';
import type { Ingredient } from '../api/types.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeIngredient, makePantryItem } from './fixtures.js';

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
      makePantryItem({
        id: 'p-3',
        ingredientId: 'ing-c',
        expiresDate: '2026-08-20',
        ingredient: makeIngredient({ id: 'ing-c', name: 'Zucchini' }),
      }),
      makePantryItem({
        id: 'p-1',
        ingredientId: 'ing-a',
        expiresDate: '2026-08-01',
        ingredient: makeIngredient({ id: 'ing-a', name: 'Apple' }),
      }),
      makePantryItem({
        id: 'p-2',
        ingredientId: 'ing-b',
        expiresDate: '2026-08-15',
        ingredient: makeIngredient({ id: 'ing-b', name: 'Banana' }),
      }),
    ];
    fetchMock.mockImplementation(routeFetch({ 'GET /api/pantry': items }, { unmatched: '404' }));

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
    const item = makePantryItem({ expiresDate: '2099-01-01', status: 'expired' });
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [item],
          'GET /api/ingredients/:id': makeIngredient(),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const row = root.querySelector<HTMLElement>('.pantry-row')!;
    expect(row.getAttribute('style') ?? '').toContain('--red');
    expect(row.querySelector('.pantry-status-line')?.textContent).toContain('expired');
  });

  test('filters by location client-side without refetching', async () => {
    const items = [
      makePantryItem({ id: 'p-1', ingredientId: 'ing-1', location: 'fridge' }),
      makePantryItem({ id: 'p-2', ingredientId: 'ing-2', location: 'freezer' }),
      makePantryItem({ id: 'p-3', ingredientId: 'ing-3', location: 'pantry' }),
    ];
    const byId: Record<string, Ingredient> = {
      'ing-1': makeIngredient({ id: 'ing-1', name: 'Milk' }),
      'ing-2': makeIngredient({ id: 'ing-2', name: 'Peas' }),
      'ing-3': makeIngredient({ id: 'ing-3', name: 'Rice' }),
    };
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': items,
          'GET /api/ingredients/:id': ({ params }) => byId[params['id']!],
        },
        { unmatched: '404' },
      ),
    );

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
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [],
          'GET /api/ingredients': ({ url }) => {
            expect(url.searchParams.get('q')).toBe('peruna');
            return [
              makeIngredient({
                id: 'ing-potato',
                name: 'Potato',
                aliases: ['peruna'],
                category: 'produce',
                defaultUnit: 'kg',
              }),
            ];
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const input = root.querySelector<HTMLInputElement>('.pantry-search-wrap input')!;
    input.value = 'peruna';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(root.querySelector('.pantry-search-result')).not.toBeNull();
    });

    const calls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => pathOf(u) === '/api/ingredients' && u.includes('q=peruna'))).toBe(
      true,
    );
    const results = [...root.querySelectorAll('.pantry-search-result')];
    expect(results.some((r) => r.textContent?.includes('Potato'))).toBe(true);
  });

  test('shows the API error message when create fails', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [],
          'GET /api/ingredients': [
            makeIngredient({ id: 'ing-x', name: 'Xylitol', aliases: [], defaultUnit: 'g' }),
          ],
          'POST /api/pantry': jsonResponse(400, { error: 'Invalid reference' }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const input = root.querySelector<HTMLInputElement>('.pantry-search-wrap input')!;
    input.value = 'xyl';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector('.pantry-search-result')).not.toBeNull();
    });

    document.querySelector<HTMLElement>('.pantry-search-result')!.click();
    document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.helper-error')?.textContent).toContain('Invalid reference');
    });
    // A generic 400 is not the no-shelf-life signal — the date field stays hidden
    // so a retry still omits expiresDate (the dedicated fallback lives in pantry-form.test.ts).
    const expires = document.querySelector<HTMLInputElement>('.pantry-form input[type="date"]');
    expect(expires?.closest('.pantry-field')?.classList.contains('hidden')).toBe(true);
  });

  test('loads the next page when the list hits the default 50-item limit', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      makePantryItem({ id: `p-${i}`, expiresDate: `2026-08-${String((i % 27) + 1).padStart(2, '0')}` }),
    );
    const page2 = [makePantryItem({ id: 'p-50', expiresDate: '2026-09-01' })];
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': ({ url }) => ((url.searchParams.get('offset') ?? '0') === '0' ? page1 : page2),
          'GET /api/ingredients/:id': makeIngredient(),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const loadMoreBtn = [...root.querySelectorAll<HTMLElement>('.pantry-tail .btn')].find(
      (b) => b.textContent === 'load more',
    );
    expect(loadMoreBtn).toBeTruthy();
    loadMoreBtn!.click();
    await vi.waitFor(() => {
      const pantryCalls = fetchMock.mock.calls
        .map((c) => c[0] as string)
        .filter((u) => pathOf(u) === '/api/pantry');
      expect(pantryCalls.length).toBeGreaterThanOrEqual(2);
      expect(pantryCalls[1]).toContain('offset=50');
    });
  });

  test('renders an empty state when the pantry has no items', async () => {
    fetchMock.mockImplementation(routeFetch({ 'GET /api/pantry': [] }, { unmatched: '404' }));

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());

    const empty = root.querySelector('.empty-state');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toMatch(/empty/i);
  });
});
