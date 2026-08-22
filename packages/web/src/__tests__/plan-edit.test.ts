// Edit-entry PATCH: the picker writes the column cook/title actually resolve.
//
// Cook, shopping, and cell titles all read `substituteRecipeId ?? recipeId`.
// Seeding the picker from that pair and then PATCHing only recipeId leaves a
// leftover substitute in place, so the edit is a no-op (or a freeform that
// still deducts the old substitute). These cases pin the mapping.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { planScreen } from '../screens/plan.js';
import { mondayOf, isoToday } from '../format/date.js';
import type { MealPlanEntry, Recipe } from '../api/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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
  return { setSubtitle: vi.fn(), navigate: vi.fn() };
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Lohikeitto',
    sourceType: 'manual',
    sourceUrl: null,
    parentRecipeId: null,
    steps: [],
    prepTime: 15,
    totalTime: 35,
    servings: 4,
    effortScore: 2,
    tags: null,
    cuisineType: null,
    userRating: null,
    timesCooked: 11,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'e-sub',
    date: MONDAY,
    slot: 'dinner',
    recipeId: 'r-orig',
    freeformNote: null,
    servings: '2',
    status: 'substituted',
    substituteRecipeId: 'r-sub',
    notes: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const MONDAY = mondayOf(isoToday());

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
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && u.pathname.startsWith('/api/meal-plans/week/')) {
      return jsonResponse(200, entries);
    }
    if (method === 'GET' && u.pathname === '/api/recipes') return jsonResponse(200, recipes);
    if (method === 'PATCH' && u.pathname.startsWith('/api/meal-plans/')) {
      const id = u.pathname.split('/').pop();
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const base = entries.find((e) => e.id === id) ?? makeEntry({ id });
      return jsonResponse(200, {
        ...base,
        ...body,
        servings: String(body['servings'] ?? base.servings),
      });
    }
    throw new Error(`unhandled request: ${method} ${u.pathname}`);
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

async function openSubstitutedEdit(root: HTMLElement): Promise<void> {
  root.querySelector<HTMLButtonElement>('.plan-cell[data-status="substituted"]')!.click();
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
  test('seeds the picker from the substitute, not the original recipeId', async () => {
    const entry = makeEntry();
    fetchMock.mockImplementation(buildRouter([entry]));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    await openSubstitutedEdit(root);

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

    await openSubstitutedEdit(root);
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

    await openSubstitutedEdit(root);
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

    await openSubstitutedEdit(root);
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

    await openSubstitutedEdit(root);
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
});
