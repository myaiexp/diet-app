// Meal plan week grid + the shared add-entry affordance.
//
// The slot-order test is the one that catches trusting the API's own text
// ordering of `slot` (which reads breakfast/dinner/lunch/snack) instead of
// the client-side SLOTS order (breakfast/lunch/dinner/snack).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { planScreen } from '../screens/plan/index.js';
import { mondayOf, isoToday } from '../format/date.js';
import type { MealPlanEntry, Recipe } from '../api/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
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
  return { setSubtitle: vi.fn(), navigate: vi.fn(), isStale: () => false };
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
    id: 'e1',
    date: MONDAY,
    slot: 'dinner',
    recipeId: null,
    freeformNote: 'Leftovers',
    servings: '2',
    status: 'planned',
    substituteRecipeId: null,
    notes: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const MONDAY = mondayOf(isoToday());

interface RouterOpts {
  entries?: MealPlanEntry[];
  recipes?: Recipe[];
}

/** Routes: week GET, recipes GET, entry POST, cook-preview GET, entry PATCH, pantry GET. */
function buildRouter(opts: RouterOpts = {}) {
  const entries = opts.entries ?? [];
  const recipes = opts.recipes ?? [];
  let createdCount = 0;

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && u.pathname.startsWith('/api/meal-plans/week/')) {
      return jsonResponse(200, entries);
    }
    if (method === 'GET' && u.pathname === '/api/recipes') {
      return jsonResponse(200, recipes);
    }
    if (method === 'POST' && u.pathname === '/api/meal-plans') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const entry = makeEntry({
        id: `new-${createdCount++}`,
        date: String(body['date'] ?? MONDAY),
        slot: (body['slot'] as MealPlanEntry['slot']) ?? 'breakfast',
        recipeId: (body['recipeId'] as string | undefined) ?? null,
        freeformNote: (body['freeformNote'] as string | undefined) ?? null,
        servings: String(body['servings'] ?? 1),
        status: 'planned',
      });
      return jsonResponse(201, entry);
    }
    if (method === 'GET' && u.pathname.endsWith('/cook-preview')) {
      return jsonResponse(200, { deductions: [], shortfalls: [], servings: 4 });
    }
    if (method === 'PATCH' && u.pathname.startsWith('/api/meal-plans/')) {
      const id = u.pathname.split('/').pop();
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const base = entries.find((e) => e.id === id) ?? makeEntry({ id });
      return jsonResponse(200, { ...base, ...body, servings: String(body['servings'] ?? base.servings) });
    }
    if (method === 'GET' && u.pathname === '/api/pantry') return jsonResponse(200, []);
    throw new Error(`unhandled request: ${method} ${u.pathname}`);
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function postCalls() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      pathOf(String(url)) === '/api/meal-plans' && ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST',
  );
}

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

describe('plan screen layout', () => {
  test('lays out 7 days x 4 slots ma..su, slots in breakfast/lunch/dinner/snack order', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    const days = [...root.querySelectorAll('.plan-day')];
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.querySelector('.plan-day-weekday')?.textContent)).toEqual([
      'ma',
      'ti',
      'ke',
      'to',
      'pe',
      'la',
      'su',
    ]);

    for (const day of days) {
      const slots = [...day.querySelectorAll('.plan-cell-slot')].map((s) => s.textContent);
      // Not alphabetical (breakfast/dinner/lunch/snack) — the client's own
      // SLOTS order, never the API's un-sorted text order.
      expect(slots).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    }
  });

  test('sets the subtitle from real week data', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    const ctx = makeCtx();
    await planScreen().mount(root, ctx);

    expect(ctx.setSubtitle).toHaveBeenCalled();
    const text = ctx.setSubtitle.mock.calls.at(-1)?.[0] as string;
    expect(text).toMatch(/^vk \d+ · /);
  });

  test('keeps the grid horizontally scrollable below 1050px rather than reflowing', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    const wrap = root.querySelector('.plan-grid-wrap');
    const grid = root.querySelector<HTMLElement>('.plan-grid');
    expect(wrap).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(wrap?.contains(grid)).toBe(true);
    // Asserted directly on the element, not through a media query: the
    // design requires min-width inside overflow-x:auto unconditionally.
    expect(grid?.style.minWidth).toBe('1050px');
  });
});

describe('add-entry affordance', () => {
  test('an empty cell opens the add-entry affordance and does not navigate', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    const ctx = makeCtx();
    await planScreen().mount(root, ctx);

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();

    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.add-entry-picker')).not.toBeNull();
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  test('creates a recipe-backed entry from the picker', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [makeRecipe({ id: 'r1', title: 'Lohikeitto' })] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-recipe-row')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('.add-entry-recipe-row[data-id="r1"]')!.click();
    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, init] = postCalls()[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body['recipeId']).toBe('r1');
    expect('freeformNote' in body).toBe(false);
    expect(body['slot']).toBe('breakfast');
    expect(body['date']).toBe(MONDAY);
  });

  test('creates a freeform-note entry with no recipe', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-picker')).not.toBeNull());

    const noteInput = document.querySelector<HTMLInputElement>('.add-entry-note')!;
    noteInput.value = 'Työlounas — canteen';
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, init] = postCalls()[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body['freeformNote']).toBe('Työlounas — canteen');
    expect('recipeId' in body).toBe(false);
  });

  test('rejects an add with neither a recipe nor a note before sending', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-picker')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    expect(postCalls()).toHaveLength(0);
    const err = document.querySelector('.helper-error');
    expect(err?.classList.contains('hidden')).toBe(false);
    expect(err?.textContent).toMatch(/recipe|note/i);
  });

  test('works with an empty recipe collection (freeform-only first run)', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('.add-entry-recipe-empty')?.textContent).toMatch(/no recipes yet/i),
    );
  });
});

describe('planned and cooked cell clicks', () => {
  test('mark skipped from a planned cell refreshes the grid to skipped', async () => {
    const entry = makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', freeformNote: 'Lohikeitto' });
    fetchMock.mockImplementation(buildRouter({ entries: [entry] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="planned"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.cook-skip')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.cook-skip')!.click();

    await vi.waitFor(() => expect(isModalOpen()).toBe(false));
    const patch = fetchMock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/meal-plans/e-planned' && (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patch).toBeTruthy();
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ status: 'skipped' });
    expect(root.querySelector('.plan-cell[data-status="skipped"]')).not.toBeNull();
    expect(root.querySelector('.plan-cell[data-status="planned"]')).toBeNull();
  });

  test('opens the cook modal from a planned cell', async () => {
    const entry = makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', freeformNote: 'Lohikeitto' });
    fetchMock.mockImplementation(buildRouter({ entries: [entry] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="planned"]')!.click();

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => pathOf(String(u)).endsWith('/cook-preview'))).toBe(true),
    );
    expect(isModalOpen()).toBe(true);
  });

  test('does not open the cook modal from a cooked cell, and explains why', async () => {
    const entry = makeEntry({ id: 'e-cooked', slot: 'lunch', status: 'cooked', freeformNote: 'Rahka bowl' });
    fetchMock.mockImplementation(buildRouter({ entries: [entry] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    const before = fetchMock.mock.calls.length;
    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="cooked"]')!.click();

    expect(isModalOpen()).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(document.querySelector('.toast')?.textContent).toMatch(/locked/i);
  });
});
