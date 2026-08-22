// Recipes screen: list + detail + servings scaler.
//
// Scaling must never be recomputed client-side (the fixtures below use scaled
// quantities that deliberately DIFFER from a naive qty*servings/base multiply,
// so a passing "no client-side math" assertion actually proves something).
// Editing must always read from an unscaled recipe, even when the scaler is
// showing a scaled view — see the dedicated test for that.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { recipesScreen } from '../screens/recipes/index.js';
import type { ScreenContext } from '../router.js';
import type { PantryItem, RecipeLineInput, RecipeWithIngredients } from '../api/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(): Promise<void> {
  // The scaler debounces refetches ~150ms; wait comfortably past it.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const ING_SALMON = {
  id: 'ing-salmon', name: 'Salmon fillet', aliases: ['lohifile'], category: 'protein',
  defaultUnit: 'g', nutritionPer100g: null, shelfLife: null, tags: null, isPantryStaple: null,
  createdAt: 't', updatedAt: 't',
};
const ING_DILL = {
  id: 'ing-dill', name: 'Dill', aliases: ['tilli'], category: 'produce',
  defaultUnit: 'g', nutritionPer100g: null, shelfLife: null, tags: null, isPantryStaple: null,
  createdAt: 't', updatedAt: 't',
};

function makeR1(): RecipeWithIngredients {
  return {
    id: 'r1', title: 'Lohikeitto', sourceType: 'manual', sourceUrl: null, parentRecipeId: null,
    steps: ['Boil the broth.', 'Add the salmon and dill.'],
    prepTime: 15, totalTime: 35, servings: 4, effortScore: 2, tags: ['fish'], cuisineType: 'Finnish',
    userRating: 5, timesCooked: 11, createdAt: 't', updatedAt: 't',
    recipeIngredients: [
      { id: 'ri-salmon', recipeId: 'r1', ingredientId: 'ing-salmon', quantity: '400', unit: 'g', optional: false, notes: null, ingredient: ING_SALMON },
      { id: 'ri-dill', recipeId: 'r1', ingredientId: 'ing-dill', quantity: '20', unit: 'g', optional: true, notes: 'chopped', ingredient: ING_DILL },
    ],
  };
}

/** Deliberately NOT 400*1.5=600 / 20*1.5=30 — proves the client isn't multiplying. */
function makeR1Scaled6(): RecipeWithIngredients {
  const base = makeR1();
  return {
    ...base,
    servings: 6,
    baseServings: 4,
    recipeIngredients: [
      { ...base.recipeIngredients[0]!, quantity: '605' },
      { ...base.recipeIngredients[1]!, quantity: '31' },
    ],
  };
}

function makeR2(): RecipeWithIngredients {
  return {
    id: 'r2', title: 'Ohrarisotto', sourceType: 'imported', sourceUrl: 'https://example.com', parentRecipeId: null,
    steps: ['Toast the barley.'], prepTime: 15, totalTime: 40, servings: 4, effortScore: 3,
    tags: ['vegetarian', 'oven'], cuisineType: 'Finnish', userRating: 4, timesCooked: 2,
    createdAt: 't', updatedAt: 't', recipeIngredients: [],
  };
}

function makeR3(): RecipeWithIngredients {
  return {
    id: 'r3', title: 'Uunilohi', sourceType: 'ai', sourceUrl: null, parentRecipeId: null,
    steps: ['Roast.'], prepTime: 10, totalTime: 45, servings: 4, effortScore: 1, tags: ['oven'],
    cuisineType: 'Finnish', userRating: 4, timesCooked: 1, createdAt: 't', updatedAt: 't',
    recipeIngredients: [],
  };
}

function makeR4(): RecipeWithIngredients {
  return {
    id: 'r4', title: 'Karjalanpaisti (fork)', sourceType: 'forked', sourceUrl: null, parentRecipeId: 'r-orig',
    steps: ['Simmer.'], prepTime: 20, totalTime: 190, servings: 6, effortScore: 2, tags: [],
    cuisineType: 'Finnish', userRating: 5, timesCooked: 3, createdAt: 't', updatedAt: 't',
    recipeIngredients: [],
  };
}

const PANTRY: PantryItem[] = [
  {
    id: 'p1', ingredientId: 'ing-salmon', quantity: '400', unit: 'g', location: 'fridge',
    addedDate: '2026-08-01', expiresDate: '2026-08-10', opened: false, status: 'fresh',
    ingredient: {
      id: 'ing-salmon', name: 'Salmon fillet', aliases: ['lohifile'], category: 'protein',
      defaultUnit: 'g', nutritionPer100g: null, shelfLife: null, tags: null,
      isPantryStaple: null, createdAt: 't', updatedAt: 't',
    },
    createdAt: 't', updatedAt: 't',
  },
];

let recipesById: Map<string, RecipeWithIngredients>;
let recipeRequests: Array<{ tags?: string }>;
let detailRequests: Array<{ id: string; servings?: string }>;
let patchRequests: Array<{ id: string; body: RecipeWithIngredients }>;
let postRequests: Array<Record<string, unknown>>;
let pantryRequestCount: number;
let idCounter: number;

function resetFixtures(): void {
  recipesById = new Map([
    ['r1', makeR1()],
    ['r2', makeR2()],
    ['r3', makeR3()],
    ['r4', makeR4()],
  ]);
  recipeRequests = [];
  detailRequests = [];
  patchRequests = [];
  postRequests = [];
  pantryRequestCount = 0;
  idCounter = 0;
}

async function router(url: string, init: RequestInit = {}): Promise<Response> {
  const u = new URL(url, 'http://x');
  const method = (init.method ?? 'GET').toUpperCase();

  if (u.pathname === '/api/pantry') {
    pantryRequestCount += 1;
    return jsonResponse(200, PANTRY);
  }

  if (u.pathname === '/api/recipes' && method === 'GET') {
    const tags = u.searchParams.get('tags') ?? undefined;
    recipeRequests.push({ tags });
    let list = [...recipesById.values()];
    if (tags) {
      const wanted = tags.split(',');
      list = list.filter((r) => wanted.every((t) => (r.tags ?? []).includes(t)));
    }
    return jsonResponse(200, list);
  }

  if (u.pathname === '/api/recipes' && method === 'POST') {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    postRequests.push(body);
    idCounter += 1;
    const id = `forked-${idCounter}`;
    const created: RecipeWithIngredients = {
      id,
      title: String(body['title']),
      sourceType: (body['sourceType'] as RecipeWithIngredients['sourceType']) ?? 'manual',
      sourceUrl: (body['sourceUrl'] as string | null) ?? null,
      parentRecipeId: (body['parentRecipeId'] as string | null) ?? null,
      steps: (body['steps'] as string[]) ?? [],
      prepTime: (body['prepTime'] as number | null) ?? null,
      totalTime: (body['totalTime'] as number | null) ?? null,
      servings: (body['servings'] as number) ?? 1,
      effortScore: (body['effortScore'] as number | null) ?? null,
      tags: (body['tags'] as string[]) ?? [],
      cuisineType: (body['cuisineType'] as string | null) ?? null,
      userRating: null,
      timesCooked: 0,
      createdAt: 't',
      updatedAt: 't',
      recipeIngredients: ((body['ingredients'] as RecipeLineInput[]) ?? []).map((l, i) => ({
        id: `line-${id}-${i}`,
        recipeId: id,
        ingredientId: l.ingredientId,
        quantity: String(l.quantity),
        unit: l.unit,
        optional: l.optional ?? false,
        notes: l.notes ?? null,
      })),
    };
    recipesById.set(id, created);
    return jsonResponse(201, created);
  }

  const detailMatch = u.pathname.match(/^\/api\/recipes\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    const id = detailMatch[1]!;
    const servings = u.searchParams.get('servings') ?? undefined;
    detailRequests.push({ id, servings });
    if (id === 'r1' && servings === '6') return jsonResponse(200, makeR1Scaled6());
    const found = recipesById.get(id);
    if (!found) return jsonResponse(404, { error: 'Not found' });
    return jsonResponse(200, found);
  }

  if (detailMatch && method === 'PATCH') {
    const id = detailMatch[1]!;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const existing = recipesById.get(id)!;
    const updated: RecipeWithIngredients = {
      ...existing,
      title: (body['title'] as string) ?? existing.title,
      servings: (body['servings'] as number) ?? existing.servings,
      cuisineType: (body['cuisineType'] as string | null) ?? existing.cuisineType,
      tags: (body['tags'] as string[]) ?? existing.tags,
      steps: (body['steps'] as string[]) ?? existing.steps,
      recipeIngredients: ((body['ingredients'] as RecipeLineInput[]) ?? []).map((l, i) => ({
        id: `line-${id}-${i}`,
        recipeId: id,
        ingredientId: l.ingredientId,
        quantity: String(l.quantity),
        unit: l.unit,
        optional: l.optional ?? false,
        notes: l.notes ?? null,
        ingredient: existing.recipeIngredients.find((x) => x.ingredientId === l.ingredientId)?.ingredient,
      })),
    };
    patchRequests.push({ id, body: updated });
    recipesById.set(id, updated);
    return jsonResponse(200, updated);
  }

  throw new Error(`unhandled request: ${method} ${url}`);
}

async function mountScreen(): Promise<{ root: HTMLElement; ctx: { setSubtitle: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> } }> {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ctx = { setSubtitle: vi.fn(), navigate: vi.fn() };
  const screen = recipesScreen();
  await screen.mount(root, ctx as unknown as ScreenContext);
  return { root, ctx };
}

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  resetFixtures();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => router(url, init ?? {}));
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  closeModal();
  resetClient();
});

describe('recipes screen — list and scaler', () => {
  test('shows a dedicated empty state pointing at import when the collection is empty', async () => {
    recipesById.clear();
    const { root, ctx } = await mountScreen();
    expect(root.querySelector('.empty-state')).not.toBeNull();
    root.querySelector<HTMLElement>('.btn-primary')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/import');
  });

  test('sets the subtitle with the real collection count', async () => {
    const { ctx } = await mountScreen();
    expect(ctx.setSubtitle).toHaveBeenCalledWith('4 in collection · filter by tag');
  });

  test('tints the source-type label by kind', async () => {
    const { root } = await mountScreen();
    // r1 (manual) is auto-selected — no color suffix.
    const manualLabel = root.querySelector<HTMLElement>('.source-label')!;
    expect(manualLabel.classList.contains('label')).toBe(true);
    expect(manualLabel.classList.contains('label-blue')).toBe(false);

    root.querySelector<HTMLElement>('[data-id="r2"]')!.click();
    await flush();
    expect(root.querySelector('.source-label')!.classList.contains('label-blue')).toBe(true);

    root.querySelector<HTMLElement>('[data-id="r3"]')!.click();
    await flush();
    expect(root.querySelector('.source-label')!.classList.contains('label-purple')).toBe(true);

    root.querySelector<HTMLElement>('[data-id="r4"]')!.click();
    await flush();
    expect(root.querySelector('.source-label')!.classList.contains('label-cyan')).toBe(true);
  });

  test('sends multiple selected tags as one comma-joined ?tags= value', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('[data-tag="quick"]')!.click();
    await flush();
    root.querySelector<HTMLElement>('[data-tag="fish"]')!.click();
    await flush();
    const last = recipeRequests[recipeRequests.length - 1]!;
    expect(last.tags).toBe('quick,fish');
  });

  test('labels each ingredient line from the pantry list without refetching it per line', async () => {
    const { root } = await mountScreen();
    const labels = [...root.querySelectorAll<HTMLElement>('.ingredient-line')].map((line) => {
      const badge = line.lastElementChild as HTMLElement;
      return { text: badge.textContent, cls: badge.className };
    });
    expect(labels[0]!.text).toBe('in pantry');
    expect(labels[0]!.cls).toContain('label-green');
    expect(labels[1]!.text).toBe('to buy');
    expect(labels[1]!.cls).toContain('label-tobuy');
    expect(pantryRequestCount).toBe(1);
  });

  test('shows "base recipe" unchanged, and "scaled ×1.5 from 4" once scaled', async () => {
    const { root } = await mountScreen();
    expect(root.querySelector('.scaler-note')!.textContent).toBe('base recipe');

    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await settle();

    expect(root.querySelector('.scaler-value')!.textContent).toBe('6');
    expect(root.querySelector('.scaler-note')!.textContent).toBe('scaled ×1.5 from 4');
  });

  test('clamps the scaler to the 1..12 range', async () => {
    const { root } = await mountScreen();
    for (let i = 0; i < 5; i += 1) root.querySelector<HTMLElement>('.scaler-minus')!.click();
    expect(root.querySelector('.scaler-value')!.textContent).toBe('1');

    for (let i = 0; i < 15; i += 1) root.querySelector<HTMLElement>('.scaler-plus')!.click();
    expect(root.querySelector('.scaler-value')!.textContent).toBe('12');
    await settle();
  });

  test('refetches with ?servings=N on scale and renders the API value, not a client-side multiply', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await settle();

    expect(detailRequests).toContainEqual({ id: 'r1', servings: '6' });
    const quantities = [...root.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent);
    // 400*1.5=600 and 20*1.5=30 would be the naive (wrong) client-side answer.
    expect(quantities).toEqual(['605 g', '31 g']);
  });
});

describe('recipes screen — fork and edit', () => {
  test('forks a recipe into a new one carrying parentRecipeId and sourceType "forked"', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.fork-btn')!.click();
    await flush();

    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]!['parentRecipeId']).toBe('r1');
    expect(postRequests[0]!['sourceType']).toBe('forked');
  });

  test('an edit resends the full ingredient list, not just the changed line', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.edit-btn')!.click();
    await flush();

    const qtyInputs = document.querySelectorAll<HTMLInputElement>('.edit-qty-input');
    expect(qtyInputs).toHaveLength(2);
    qtyInputs[0]!.value = '999';

    document.querySelector<HTMLElement>('.modal-foot .btn-primary')!.click();
    await flush();

    expect(patchRequests).toHaveLength(1);
    const sent = patchRequests[0]!.body.recipeIngredients;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ ingredientId: 'ing-salmon', quantity: '999' });
    expect(sent[1]).toMatchObject({ ingredientId: 'ing-dill', quantity: '20' });
  });

  test('an edit made while scaled to ×1.5 reads and persists unscaled quantities', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await settle();
    expect(root.querySelector('.scaler-note')!.textContent).toBe('scaled ×1.5 from 4');

    root.querySelector<HTMLElement>('.edit-btn')!.click();
    await flush();

    // The edit form must show the true base quantities (400/20), not 605/31.
    const qtyInputs = document.querySelectorAll<HTMLInputElement>('.edit-qty-input');
    expect(qtyInputs[0]!.value).toBe('400');
    expect(qtyInputs[1]!.value).toBe('20');

    document.querySelector<HTMLElement>('.modal-foot .btn-primary')!.click();
    await flush();

    const sent = patchRequests[patchRequests.length - 1]!.body.recipeIngredients;
    expect(sent[0]).toMatchObject({ quantity: '400' });
    expect(sent[1]).toMatchObject({ quantity: '20' });
  });
});
