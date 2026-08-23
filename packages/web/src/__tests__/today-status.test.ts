// Today slot CTAs for substituted/skipped — substituted is still demand
// (shopping and POST /cook treat it like planned); skipped is a decision
// not to cook. Plan reopens those cells for edit and never cooks them.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { todayScreen } from '../screens/today/index.js';
import { mondayOf, isoToday } from '../format/date.js';
import type { MealPlanEntry, PantryItem, Recipe } from '../api/types.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeEntry, makeIngredient, makePantryItem, makeRecipe } from './fixtures.js';

const TODAY = isoToday();
const MONDAY = mondayOf(TODAY);

interface RouterOpts {
  entries?: MealPlanEntry[];
  pantry?: PantryItem[];
  recipes?: Recipe[];
}

function buildRouter(opts: RouterOpts = {}) {
  const entries = opts.entries ?? [];
  const pantry = opts.pantry ?? [makePantryItem()];
  const recipes = opts.recipes ?? [];

  return routeFetch({
    [`GET /api/meal-plans/week/${MONDAY}`]: entries,
    'GET /api/pantry': pantry,
    'GET /api/recipes': recipes,
    'GET /api/recipes/:id': ({ params }) => makeRecipe({ id: params['id'] }),
    'GET /api/meal-plans/:id/cook-preview': { deductions: [], shortfalls: [], servings: 4 },
    'GET /api/meal-plans/:id/feedback': jsonResponse(404, { error: 'Not found' }),
  });
}

function slotRow(root: HTMLElement, slot: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>('.today-slot-row')].find(
    (r) => r.querySelector('.today-slot-name')?.textContent === slot,
  );
  if (!row) throw new Error(`no slot row for ${slot}`);
  return row;
}

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

describe('today substituted and skipped slots', () => {
  test('a substituted row offers cook →, a skipped row has no action', async () => {
    const entries = [
      makeEntry({
        id: 'e-sub',
        slot: 'lunch',
        status: 'substituted',
        freeformNote: null,
        recipeId: 'r-original',
        substituteRecipeId: 'r-sub',
      }),
      makeEntry({ id: 'e-skip', slot: 'dinner', status: 'skipped', freeformNote: 'Lohikeitto' }),
    ];
    const recipes = [
      makeRecipe({ id: 'r-original', title: 'Original Dish' }),
      makeRecipe({ id: 'r-sub', title: 'Substitute Dish' }),
    ];
    fetchMock.mockImplementation(buildRouter({ entries, recipes }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const lunch = slotRow(root, 'lunch');
    expect(lunch.querySelector('.row-title')?.textContent).toBe('Substitute Dish');
    const cookBtn = lunch.querySelector<HTMLButtonElement>('button');
    expect(cookBtn?.textContent).toBe('cook →');
    expect(cookBtn?.className).toContain('btn-primary');

    const dinner = slotRow(root, 'dinner');
    expect(dinner.textContent).toContain('skipped');
    expect(dinner.querySelector('button')).toBeNull();
  });

  test('cook → on a substituted row opens the cook flow, not an edit', async () => {
    const entries = [
      makeEntry({
        id: 'e-sub',
        slot: 'lunch',
        status: 'substituted',
        freeformNote: null,
        recipeId: 'r-original',
        substituteRecipeId: 'r-sub',
      }),
    ];
    const recipes = [makeRecipe({ id: 'r-sub', title: 'Substitute Dish' })];
    fetchMock.mockImplementation(buildRouter({ entries, recipes }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    slotRow(root, 'lunch').querySelector<HTMLButtonElement>('button')!.click();

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => pathOf(String(u)).endsWith('/cook-preview'))).toBe(true),
    );
    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.plan-edit-save')).toBeNull();
    expect(document.querySelector('.cook-commit')).not.toBeNull();
  });

  test("what now offers Cook tonight's for a substituted dinner, same as planned", async () => {
    const entries = [
      makeEntry({
        id: 'e-sub',
        slot: 'dinner',
        status: 'substituted',
        freeformNote: null,
        recipeId: 'r-original',
        substituteRecipeId: 'r-sub',
      }),
    ];
    const recipes = [makeRecipe({ id: 'r-sub', title: 'Substitute Dish' })];
    fetchMock.mockImplementation(buildRouter({ entries, recipes }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const row = [...root.querySelectorAll('.today-whatnow-row')].find((r) =>
      r.textContent?.includes("Cook tonight's Substitute Dish"),
    );
    expect(row).toBeTruthy();
  });
});
