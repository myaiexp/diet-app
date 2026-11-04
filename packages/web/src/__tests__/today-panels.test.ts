// Today screen panels: spoiling list, request budget, recipe titles

import './pin-sunday.js';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { todayScreen } from '../screens/today/index.js';
import type { MealPlanEntry } from '../api/types.js';
import { makeCtx, mountRoot, routeFetch } from './harness.js';
import { makeEntry, makeIngredient, makePantryItem, makeRecipe } from './fixtures.js';
import { buildRouter, MONDAY } from './today-test-helpers.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  resetClient();
  closeModal();
});

describe('spoiling panel', () => {
  test('lists the five soonest-expiring pantry items in the order the API returned them', async () => {
    // Deliberately not sorted alphabetically nor by expiry — only trusting
    // the response as-is reproduces this order.
    const pantry = ['Dill', 'Salmon', 'Quark', 'Milk', 'Spinach', 'Chicken'].map((name, i) =>
      makePantryItem({
        id: `p-${i}`,
        ingredientId: `ing-${i}`,
        ingredient: makeIngredient({ id: `ing-${i}`, name }),
        expiresDate: '2026-08-10',
      }),
    );
    fetchMock.mockImplementation(buildRouter({ pantry }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const names = [...root.querySelectorAll('.today-spoil-row .row-title')].map((n) => n.textContent);
    expect(names).toEqual(['Dill', 'Salmon', 'Quark', 'Milk', 'Spinach']);
  });

  test('counts every pantry item, not just the API default page of 50', async () => {
    // The real API defaults to 50 when `limit` is omitted. A mock that
    // mimics that default is what would have caught today.ts calling
    // listPantry() with no paging — the unbounded mock used elsewhere
    // silently hid the truncation.
    const pantry = Array.from({ length: 51 }, (_, i) =>
      makePantryItem({
        id: `p-${i}`,
        ingredientId: `ing-${i}`,
        status: 'expired',
        ingredient: makeIngredient({ id: `ing-${i}`, name: `Item ${i}` }),
      }),
    );
    fetchMock.mockImplementation(
      routeFetch({
        [`GET /api/meal-plans/week/${MONDAY}`]: [],
        'GET /api/pantry': ({ url }) => {
          const limit = Number(url.searchParams.get('limit') ?? 50);
          const offset = Number(url.searchParams.get('offset') ?? 0);
          return pantry.slice(offset, offset + limit);
        },
        'GET /api/recipes': [],
      }),
    );

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const cellFor = (key: string) =>
      [...root.querySelectorAll('.stat-cell')].find((c) => c.querySelector('.stat-key')?.textContent === key);
    expect(cellFor('expired')?.querySelector('.stat-value')?.textContent).toBe('51');
  });
});

describe('request budget', () => {
  test('derives every stat tile and row from three bounded requests, not one per row or tile', async () => {
    const entries = [
      makeEntry({ id: 'e1', slot: 'breakfast', status: 'planned' }),
      makeEntry({ id: 'e2', slot: 'lunch', status: 'planned' }),
      makeEntry({ id: 'e3', slot: 'dinner', status: 'planned', freeformNote: null, recipeId: 'r1' }),
      makeEntry({ id: 'e4', slot: 'snack', status: 'planned' }),
    ];
    const pantry = [
      makePantryItem({ id: 'p-expired', status: 'expired', ingredient: makeIngredient({ name: 'Dill' }) }),
      makePantryItem({ id: 'p-today', status: 'use_today', ingredient: makeIngredient({ name: 'Salmon' }) }),
      makePantryItem({ id: 'p-fresh', status: 'fresh', ingredient: makeIngredient({ name: 'Carrot' }) }),
    ];
    const recipes = [makeRecipe({ id: 'r1', title: 'Lohikeitto' })];
    fetchMock.mockImplementation(buildRouter({ entries, pantry, recipes }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    // No cooked entries today, so the feedback lookup never fires: exactly
    // the week GET, the pantry GET, and the recipes GET — nothing per row or
    // per tile.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const cellFor = (key: string) =>
      [...root.querySelectorAll('.stat-cell')].find((c) => c.querySelector('.stat-key')?.textContent === key);
    expect(cellFor('use today')?.querySelector('.stat-value')?.textContent).toBe('1');
    expect(cellFor('expired')?.querySelector('.stat-value')?.textContent).toBe('1');
  });

  test('the request count does not grow with the number of entries, pantry items, or recipes', async () => {
    const entries: MealPlanEntry[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(`${MONDAY}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + d);
      const iso = date.toISOString().slice(0, 10);
      for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
        entries.push(makeEntry({ id: `e-${iso}-${slot}`, date: iso, slot, status: 'planned' }));
      }
    }
    const pantry = Array.from({ length: 20 }, (_, i) =>
      makePantryItem({
        id: `p-${i}`,
        ingredientId: `ing-${i}`,
        ingredient: makeIngredient({ id: `ing-${i}`, name: `Item ${i}` }),
      }),
    );
    const recipes = Array.from({ length: 10 }, (_, i) => makeRecipe({ id: `r-${i}`, title: `Recipe ${i}` }));
    fetchMock.mockImplementation(buildRouter({ entries, pantry, recipes }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    // 28 plan entries, 20 pantry rows, 10 recipes — still exactly three
    // requests: the guarantee is "never one per row", not a magic "two".
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('recipe titles', () => {
  test('a recipe-backed entry renders its real title from the loaded collection', async () => {
    const entries = [
      makeEntry({ id: 'e1', slot: 'dinner', status: 'planned', freeformNote: null, recipeId: 'r-lohikeitto' }),
    ];
    const recipes = [makeRecipe({ id: 'r-lohikeitto', title: 'Lohikeitto' })];
    fetchMock.mockImplementation(buildRouter({ entries, recipes, pantry: [makePantryItem()] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(root.querySelector('.today-slot-row .row-title')?.textContent).toBe('Lohikeitto');
  });

  test('a substituted entry renders the substitute recipe title, not the original', async () => {
    const entries = [
      makeEntry({
        id: 'e1',
        slot: 'lunch',
        status: 'substituted',
        freeformNote: null,
        recipeId: 'r-original',
        substituteRecipeId: 'r-sub',
      }),
    ];
    const recipes = [
      makeRecipe({ id: 'r-original', title: 'Original Dish' }),
      makeRecipe({ id: 'r-sub', title: 'Substitute Dish' }),
    ];
    fetchMock.mockImplementation(buildRouter({ entries, recipes, pantry: [makePantryItem()] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(root.querySelector('.today-slot-row .row-title')?.textContent).toBe('Substitute Dish');
  });

  test('a recipe id missing from the loaded collection degrades gracefully instead of crashing', async () => {
    const entries = [
      makeEntry({ id: 'e1', slot: 'snack', status: 'planned', freeformNote: null, recipeId: 'r-unknown' }),
    ];
    fetchMock.mockImplementation(buildRouter({ entries, recipes: [], pantry: [makePantryItem()] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(root.querySelector('.today-slot-row .row-title')?.textContent).toBe('(recipe)');
  });
});
