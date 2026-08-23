// Edit-entry PATCH for skipped/substituted cells — picker maps onto cook's resolve.
//
// Cook, shopping, and cell titles all read `substituteRecipeId ?? recipeId`.
// Seeding the picker from that pair and then PATCHing only recipeId leaves a
// leftover substitute in place, so the edit is a no-op (or a freeform that
// still deducts the old substitute). These cases pin the mapping.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { planScreen } from '../screens/plan/index.js';
import { mondayOf, isoToday } from '../format/date.js';
import type { MealPlanEntry, Recipe } from '../api/types.js';
import { makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeEntry as makeSharedEntry, makeRecipe } from './fixtures.js';

const MONDAY = mondayOf(isoToday());

function makeEntry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return makeSharedEntry({
    id: 'e-sub',
    date: MONDAY,
    recipeId: 'r-orig',
    freeformNote: null,
    status: 'substituted',
    substituteRecipeId: 'r-sub',
    ...overrides,
  });
}

const RECIPES = [
  makeRecipe({ id: 'r-orig', title: 'Original Dish' }),
  makeRecipe({ id: 'r-sub', title: 'Substitute Dish' }),
  makeRecipe({ id: 'r-new', title: 'New Pick' }),
];

/** Same resolution cook / shopping / cell titles use. */
function resolvedRecipeId(entry: {
  recipeId: string | null;
  substituteRecipeId: string | null;
}): string | null {
  return entry.substituteRecipeId ?? entry.recipeId;
}

function buildRouter(entries: MealPlanEntry[], recipes: Recipe[] = RECIPES) {
  return routeFetch({
    'GET /api/meal-plans/week/:monday': entries,
    'GET /api/recipes': recipes,
    'PATCH /api/meal-plans/:id': ({ params, json }) => {
      const id = params['id'];
      const body = json<Record<string, unknown>>();
      const base = entries.find((e) => e.id === id) ?? makeEntry({ id });
      return { ...base, ...body, servings: String(body['servings'] ?? base.servings) };
    },
  });
}

function patchBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        pathOf(String(url)).startsWith('/api/meal-plans/') &&
        pathOf(String(url)) !== '/api/meal-plans' &&
        ((init as RequestInit | undefined)?.method ?? 'GET') === 'PATCH',
    )
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

async function openEdit(root: HTMLElement, status: 'skipped' | 'substituted'): Promise<void> {
  root.querySelector<HTMLButtonElement>(`.plan-cell[data-status="${status}"]`)!.click();
  await vi.waitFor(() => expect(document.querySelector('.plan-edit-save')).not.toBeNull());
}

async function saveAndPatch(fetchMock: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  document.querySelector<HTMLButtonElement>('.plan-edit-save')!.click();
  await vi.waitFor(() => expect(patchBodies(fetchMock)).toHaveLength(1));
  return patchBodies(fetchMock)[0]!;
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

describe('edit substituted entry', () => {
  test('clicking a substituted cell opens edit, not cook', async () => {
    const entry = makeEntry();
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    await openEdit(root, 'substituted');

    expect(document.querySelector('.cook-commit')).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => pathOf(String(u)).endsWith('/cook-preview'))).toBe(false);
  });

  test('seeds the picker from the substitute, not the original recipeId', async () => {
    const entry = makeEntry();
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    await openEdit(root, 'substituted');

    expect(document.querySelector('.add-entry-recipe-row[data-id="r-sub"]')?.classList.contains('is-selected')).toBe(
      true,
    );
    expect(document.querySelector('.add-entry-recipe-row[data-id="r-orig"]')?.classList.contains('is-selected')).toBe(
      false,
    );
  });

  test('picking a new recipe writes substituteRecipeId so cook would resolve the pick', async () => {
    const entry = makeEntry();
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    expect(root.querySelector('.plan-cell-title')?.textContent).toBe('Substitute Dish');

    await openEdit(root, 'substituted');
    document.querySelector<HTMLButtonElement>('.add-entry-recipe-row[data-id="r-new"]')!.click();
    const body = await saveAndPatch(fetchMock);

    expect(body['substituteRecipeId']).toBe('r-new');
    expect(body['recipeId']).toBeUndefined();
    expect(body['freeformNote']).toBeNull();

    const after = { ...entry, ...body } as MealPlanEntry;
    expect(resolvedRecipeId(after)).toBe('r-new');
    expect(after.recipeId).toBe('r-orig');

    await vi.waitFor(() => expect(root.querySelector('.plan-cell-title')?.textContent).toBe('New Pick'));
  });

  test('switching status to planned writes the pick onto recipeId and clears the substitute', async () => {
    const entry = makeEntry();
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    await openEdit(root, 'substituted');
    const statusSelect = document.querySelector<HTMLSelectElement>('.plan-edit-status')!;
    statusSelect.value = 'planned';
    const body = await saveAndPatch(fetchMock);

    expect(body['status']).toBe('planned');
    expect(body['recipeId']).toBe('r-sub');
    expect(body['substituteRecipeId']).toBeNull();

    const after = { ...entry, ...body } as MealPlanEntry;
    expect(resolvedRecipeId(after)).toBe('r-sub');
  });

  test('a substitute-only row (recipeId null) still writes the pick onto substituteRecipeId', async () => {
    const entry = makeEntry({ recipeId: null });
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    await openEdit(root, 'substituted');
    document.querySelector<HTMLButtonElement>('.add-entry-recipe-row[data-id="r-new"]')!.click();
    const body = await saveAndPatch(fetchMock);

    expect(body['substituteRecipeId']).toBe('r-new');
    expect(body['recipeId']).toBeUndefined();

    const after = { ...entry, ...body } as MealPlanEntry;
    expect(after.recipeId).toBeNull();
    expect(resolvedRecipeId(after)).toBe('r-new');
  });

  test('converting to a freeform note clears both recipe fields so cook would deduct nothing', async () => {
    const entry = makeEntry();
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    await openEdit(root, 'substituted');
    const noteInput = document.querySelector<HTMLInputElement>('.add-entry-note')!;
    noteInput.value = 'Työlounas — canteen';
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
    const body = await saveAndPatch(fetchMock);

    expect(body['recipeId']).toBeNull();
    expect(body['substituteRecipeId']).toBeNull();
    expect(body['freeformNote']).toBe('Työlounas — canteen');

    const after = { ...entry, ...body } as MealPlanEntry;
    expect(resolvedRecipeId(after)).toBeNull();
  });

  test('a no-change save writes the current substitute and does not clobber recipeId', async () => {
    const entry = makeEntry();
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    await openEdit(root, 'substituted');
    const body = await saveAndPatch(fetchMock);

    expect(body['substituteRecipeId']).toBe('r-sub');
    expect(body['recipeId']).toBeUndefined();
    expect(body['freeformNote']).toBeNull();
    expect(body['servings']).toBe(2);

    const after = { ...entry, ...body } as MealPlanEntry;
    expect(after.recipeId).toBe('r-orig');
    expect(resolvedRecipeId(after)).toBe('r-sub');
  });
});

describe('edit skipped entry', () => {
  test('picking a new recipe writes recipeId, servings, and status, and clears substituteRecipeId', async () => {
    const entry = makeEntry({
      id: 'e-skip',
      status: 'skipped',
      recipeId: 'r-orig',
      // leftover substitute must be cleared — omitting it leaves cook resolving r-sub
      substituteRecipeId: 'r-sub',
    });
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    await openEdit(root, 'skipped');
    document.querySelector<HTMLButtonElement>('.add-entry-recipe-row[data-id="r-new"]')!.click();
    document.querySelector<HTMLInputElement>('.plan-edit-form input[type="number"]')!.value = '5';
    const statusSelect = document.querySelector<HTMLSelectElement>('.plan-edit-status')!;
    statusSelect.value = 'planned';
    const body = await saveAndPatch(fetchMock);

    expect(body['recipeId']).toBe('r-new');
    expect(body['substituteRecipeId']).toBeNull();
    expect(body['freeformNote']).toBeNull();
    expect(body['servings']).toBe(5);
    expect(body['status']).toBe('planned');

    const after = { ...entry, ...body } as MealPlanEntry;
    expect(resolvedRecipeId(after)).toBe('r-new');
  });
});
