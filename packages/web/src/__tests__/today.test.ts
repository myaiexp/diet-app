// Today screen: three bounded requests (week + pantry + recipe collection)
// back every tile and row — never one per row or tile — per-slot actions are
// state-dependent and show real recipe titles, the spoiling panel never
// re-sorts, placeholders stay honest about missing endpoints, "what now" rows
// are real navigations, and a 404 from getFeedback reads as "unrated" rather
// than an error.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { todayScreen } from '../screens/today/index.js';
import { mondayOf, isoToday } from '../format/date.js';
import type { MealPlanEntry, PantryItem, Ingredient, CookFeedback, Recipe } from '../api/types.js';

const TODAY = isoToday();
const MONDAY = mondayOf(TODAY);

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
  return { setSubtitle: vi.fn(), navigate: vi.fn() };
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
    ingredient: makeIngredient(),
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'e1',
    date: TODAY,
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

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Lohikeitto',
    sourceType: 'manual',
    sourceUrl: null,
    parentRecipeId: null,
    steps: [],
    prepTime: null,
    totalTime: null,
    servings: 4,
    effortScore: null,
    tags: null,
    cuisineType: null,
    userRating: null,
    timesCooked: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeFeedback(entryId: string): CookFeedback {
  return {
    id: `fb-${entryId}`,
    mealPlanEntryId: entryId,
    rating: 'thumbs_up',
    effortCheck: 'felt_right',
    makeAgain: 'yes',
    usedAsIs: true,
    changesNote: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

interface RouterOpts {
  entries?: MealPlanEntry[];
  pantry?: PantryItem[];
  recipes?: Recipe[];
  /** Entry ids whose GET .../feedback resolves 200; anything else 404s. */
  ratedEntryIds?: string[];
}

/** Routes: week GET, pantry GET, recipes GET, per-entry feedback GET. */
function buildRouter(opts: RouterOpts = {}) {
  const entries = opts.entries ?? [];
  const pantry = opts.pantry ?? [];
  const recipes = opts.recipes ?? [];
  const rated = new Set(opts.ratedEntryIds ?? []);

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && u.pathname === `/api/meal-plans/week/${MONDAY}`) {
      return jsonResponse(200, entries);
    }
    if (method === 'GET' && u.pathname === '/api/pantry') {
      return jsonResponse(200, pantry);
    }
    if (method === 'GET' && u.pathname === '/api/recipes') {
      return jsonResponse(200, recipes);
    }
    const feedbackMatch = /^\/api\/meal-plans\/([^/]+)\/feedback$/.exec(u.pathname);
    if (method === 'GET' && feedbackMatch) {
      const id = feedbackMatch[1]!;
      if (rated.has(id)) return jsonResponse(200, makeFeedback(id));
      return jsonResponse(404, { error: 'Not found' });
    }
    throw new Error(`unhandled request: ${method} ${u.pathname}`);
  });
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

describe('today slots', () => {
  test('shows a state-dependent action for each of the four slots', async () => {
    const entries = [
      makeEntry({ id: 'e-rated', slot: 'breakfast', status: 'cooked', freeformNote: 'Rahka bowl' }),
      makeEntry({ id: 'e-unrated', slot: 'lunch', status: 'cooked', freeformNote: 'Ruisleipä' }),
      makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', freeformNote: 'Lohikeitto' }),
      // snack left empty on purpose
    ];
    fetchMock.mockImplementation(buildRouter({ entries, ratedEntryIds: ['e-rated'] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const rows = [...root.querySelectorAll('.today-slot-row')];
    expect(rows).toHaveLength(4);

    const [breakfast, lunch, dinner, snack] = rows;
    expect(breakfast!.classList.contains('is-dimmed')).toBe(true);
    expect(breakfast!.querySelector('button')).toBeNull();

    expect(lunch!.classList.contains('is-dimmed')).toBe(false);
    expect(lunch!.querySelector('button')?.textContent).toBe('rate');

    const cookBtn = dinner!.querySelector<HTMLButtonElement>('button');
    expect(cookBtn?.textContent).toBe('cook →');
    expect(cookBtn?.className).toContain('btn-primary');

    expect(snack!.querySelector('button')?.textContent).toBe('fill');
  });

  test('an empty slot opens the add-entry affordance without navigating', async () => {
    // A non-empty pantry keeps this out of the first-run state, which has no
    // per-slot fill buttons at all.
    fetchMock.mockImplementation(buildRouter({ pantry: [makeItem()] }));
    const root = mountRoot();
    const ctx = makeCtx();
    await todayScreen().mount(root, ctx);

    const fillBtn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'fill')!;
    fillBtn.click();

    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.add-entry-picker')).not.toBeNull();
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  test('a 404 from getFeedback means unrated, not an error banner', async () => {
    const entries = [makeEntry({ id: 'e-unrated', slot: 'breakfast', status: 'cooked', freeformNote: 'Bowl' })];
    fetchMock.mockImplementation(buildRouter({ entries, ratedEntryIds: [] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(document.querySelector('.error-panel')).toBeNull();
    const row = root.querySelector('.today-slot-row')!;
    expect(row.querySelector('button')?.textContent).toBe('rate');
  });
});

describe('spoiling panel', () => {
  test('lists the five soonest-expiring pantry items in the order the API returned them', async () => {
    // Deliberately not sorted alphabetically nor by expiry — only trusting
    // the response as-is reproduces this order.
    const pantry = ['Dill', 'Salmon', 'Quark', 'Milk', 'Spinach', 'Chicken'].map((name, i) =>
      makeItem({
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
      makeItem({
        id: `p-${i}`,
        ingredientId: `ing-${i}`,
        status: 'expired',
        ingredient: makeIngredient({ id: `ing-${i}`, name: `Item ${i}` }),
      }),
    );
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && u.pathname === `/api/meal-plans/week/${MONDAY}`) {
        return jsonResponse(200, []);
      }
      if (method === 'GET' && u.pathname === '/api/pantry') {
        const limit = Number(u.searchParams.get('limit') ?? 50);
        const offset = Number(u.searchParams.get('offset') ?? 0);
        return jsonResponse(200, pantry.slice(offset, offset + limit));
      }
      if (method === 'GET' && u.pathname === '/api/recipes') {
        return jsonResponse(200, []);
      }
      throw new Error(`unhandled request: ${method} ${u.pathname}`);
    });

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
      makeItem({ id: 'p-expired', status: 'expired', ingredient: makeIngredient({ name: 'Dill' }) }),
      makeItem({ id: 'p-today', status: 'use_today', ingredient: makeIngredient({ name: 'Salmon' }) }),
      makeItem({ id: 'p-fresh', status: 'fresh', ingredient: makeIngredient({ name: 'Carrot' }) }),
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
      makeItem({
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
    fetchMock.mockImplementation(buildRouter({ entries, recipes, pantry: [makeItem()] }));

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
    fetchMock.mockImplementation(buildRouter({ entries, recipes, pantry: [makeItem()] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(root.querySelector('.today-slot-row .row-title')?.textContent).toBe('Substitute Dish');
  });

  test('a recipe id missing from the loaded collection degrades gracefully instead of crashing', async () => {
    const entries = [
      makeEntry({ id: 'e1', slot: 'snack', status: 'planned', freeformNote: null, recipeId: 'r-unknown' }),
    ];
    fetchMock.mockImplementation(buildRouter({ entries, recipes: [], pantry: [makeItem()] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(root.querySelector('.today-slot-row .row-title')?.textContent).toBe('(recipe)');
  });
});

describe('stat strip', () => {
  test('renders a muted placeholder, never a number, for tiles with no backing endpoint', async () => {
    fetchMock.mockImplementation(buildRouter({ pantry: [makeItem({ status: 'fresh' })] }));
    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const placeholders = [...root.querySelectorAll('.stat-placeholder')];
    expect(placeholders).toHaveLength(3); // eaten kcal, protein, to buy
    for (const p of placeholders) expect(p.textContent).toBe('—');

    const cellFor = (key: string) =>
      [...root.querySelectorAll('.stat-cell')].find((c) => c.querySelector('.stat-key')?.textContent === key);
    expect(cellFor('eaten')?.querySelector('.stat-value')?.classList.contains('stat-placeholder')).toBe(true);
    expect(cellFor('use today')?.querySelector('.stat-value')?.classList.contains('stat-placeholder')).toBe(false);
  });
});

describe('what now', () => {
  test('each row navigates to the screen that resolves it', async () => {
    const pantry = [makeItem({ id: 'p-expired', status: 'expired', ingredient: makeIngredient({ name: 'Dill' }) })];
    fetchMock.mockImplementation(buildRouter({ entries: [], pantry }));

    const root = mountRoot();
    const ctx = makeCtx();
    await todayScreen().mount(root, ctx);

    const rows = [...root.querySelectorAll<HTMLButtonElement>('.today-whatnow-row')];
    expect(rows.length).toBeGreaterThan(0);

    const expiredRow = rows.find((r) => r.textContent?.includes('expired'))!;
    expect(expiredRow).toBeTruthy();
    expiredRow.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/pantry');

    const openTodayRow = rows.find((r) => r.textContent?.includes('open today'))!;
    expect(openTodayRow).toBeTruthy();
    openTodayRow.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/plan');
  });

  test('renders fewer rows, not fabricated ones, when nothing needs attention', async () => {
    // A full week (28 slots) and a pantry with nothing urgent: no expired,
    // nothing due today, no empty slot, no empty day. Today's own dinner is
    // already cooked (not "planned"), so the new "cook tonight's X" row
    // — itself a legitimate, substantiated row — doesn't fire either: this
    // fixture is deliberately the case where truly nothing is left to do.
    const entries: MealPlanEntry[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(`${MONDAY}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + d);
      const iso = date.toISOString().slice(0, 10);
      for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
        const status = iso === TODAY && slot === 'dinner' ? 'cooked' : 'planned';
        entries.push(makeEntry({ id: `e-${iso}-${slot}`, date: iso, slot, status }));
      }
    }
    const pantry = [makeItem({ status: 'fresh' })];
    fetchMock.mockImplementation(buildRouter({ entries, pantry }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(root.querySelectorAll('.today-whatnow-row')).toHaveLength(0);
    expect(root.querySelector('.today-whatnow-empty')).not.toBeNull();
  });
});

describe('first run', () => {
  test('renders a coherent first-run state when the pantry and the week are both empty', async () => {
    fetchMock.mockImplementation(buildRouter({ entries: [], pantry: [] }));
    const root = mountRoot();
    const ctx = makeCtx();
    await todayScreen().mount(root, ctx);

    const panel = root.querySelector('.today-first-run');
    expect(panel).not.toBeNull();
    // Not four empty boxes: the normal stat strip / slots / spoiling layout
    // must not also render alongside the first-run panel.
    expect(root.querySelector('.today-stat-strip')).toBeNull();
    expect(root.querySelector('.today-slots')).toBeNull();

    const buttons = [...panel!.querySelectorAll('button')];
    expect(buttons.some((b) => b.textContent?.includes('pantry'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('import'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('plan'))).toBe(true);

    buttons.find((b) => b.textContent?.includes('pantry'))!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/pantry');
  });
});
