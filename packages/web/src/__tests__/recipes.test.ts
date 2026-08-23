// Recipes screen: list + detail + servings scaler.
//
// Scaling must never be recomputed client-side (the fixtures below use scaled
// quantities that deliberately DIFFER from a naive qty*servings/base multiply,
// so a passing "no client-side math" assertion actually proves something).
// A failed scale fetch must not leave N-serving chrome over the previous
// quantities; switching recipes mid-fetch must not paint the old recipe's
// scaled lines. Editing must always read from an unscaled recipe, even when
// the scaler is showing a scaled view — see the dedicated test for that.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { recipesScreen } from '../screens/recipes/index.js';
import type { PantryItem, RecipeLineInput, RecipeWithIngredients } from '../api/types.js';

import { flush, jsonResponse, makeCtx, mountRoot, routeFetch } from './harness.js';
import { makeIngredient, makePantryItem, makeRecipe } from './fixtures.js';

const ING_SALMON = makeIngredient({
  id: 'ing-salmon',
  name: 'Salmon fillet',
  aliases: ['lohifile'],
  category: 'protein',
  defaultUnit: 'g',
});
const ING_DILL = makeIngredient({
  id: 'ing-dill',
  name: 'Dill',
  aliases: ['tilli'],
  category: 'produce',
  defaultUnit: 'g',
});

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
  makePantryItem({ id: 'p1', ingredientId: 'ing-salmon', ingredient: ING_SALMON }),
];

let recipesById: Map<string, RecipeWithIngredients>;
let recipeRequests: Array<{ tags?: string }>;
let detailRequests: Array<{ id: string; servings?: string }>;
let patchRequests: Array<{ id: string; body: RecipeWithIngredients }>;
let postRequests: Array<Record<string, unknown>>;
let pantryRequestCount: number;
let idCounter: number;
/** Override GET /recipes/r1?servings=6 — default returns the non-naive scaled fixture. */
let scale6: () => RecipeWithIngredients | Response | Promise<RecipeWithIngredients | Response>;

async function waitForScaledFetch(servings: string): Promise<void> {
  await vi.waitFor(() => {
    expect(detailRequests.some((r) => r.servings === servings)).toBe(true);
  });
}

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
  scale6 = () => makeR1Scaled6();
}

function appRouter() {
  return routeFetch({
    'GET /api/pantry': () => {
      pantryRequestCount += 1;
      return PANTRY;
    },
    'GET /api/recipes': ({ url }) => {
      const tags = url.searchParams.get('tags') ?? undefined;
      recipeRequests.push({ tags });
      let list = [...recipesById.values()];
      if (tags) {
        const wanted = tags.split(',');
        list = list.filter((r) => wanted.every((t) => (r.tags ?? []).includes(t)));
      }
      return list;
    },
    'POST /api/recipes': ({ json }) => {
      const body = json<Record<string, unknown>>();
      postRequests.push(body);
      idCounter += 1;
      const id = `forked-${idCounter}`;
      const created: RecipeWithIngredients = {
        ...makeRecipe({
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
        }),
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
    },
    'GET /api/recipes/:id': ({ params, url }) => {
      const id = params['id']!;
      const servings = url.searchParams.get('servings') ?? undefined;
      detailRequests.push({ id, servings });
      if (id === 'r1' && servings === '6') return scale6();
      const found = recipesById.get(id);
      return found ?? jsonResponse(404, { error: 'Not found' });
    },
    'PATCH /api/recipes/:id': ({ params, json }) => {
      const id = params['id']!;
      const body = json<Record<string, unknown>>();
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
      return updated;
    },
  });
}

async function mountScreen(): Promise<{ root: HTMLElement; ctx: ReturnType<typeof makeCtx> }> {
  const root = mountRoot();
  const ctx = makeCtx();
  await recipesScreen().mount(root, ctx);
  return { root, ctx };
}

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  resetFixtures();
  configureClient({ fetch: appRouter() as unknown as typeof fetch });
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
    await vi.waitFor(() =>
      expect(root.querySelector('.source-label')!.classList.contains('label-blue')).toBe(true),
    );

    root.querySelector<HTMLElement>('[data-id="r3"]')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.source-label')!.classList.contains('label-purple')).toBe(true),
    );

    root.querySelector<HTMLElement>('[data-id="r4"]')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.source-label')!.classList.contains('label-cyan')).toBe(true),
    );
  });

  test('sends multiple selected tags as one comma-joined ?tags= value', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('[data-tag="quick"]')!.click();
    await vi.waitFor(() => expect(recipeRequests.some((r) => r.tags === 'quick')).toBe(true));
    root.querySelector<HTMLElement>('[data-tag="fish"]')!.click();
    await vi.waitFor(() => expect(recipeRequests.at(-1)?.tags).toBe('quick,fish'));
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
    await waitForScaledFetch('6');

    expect(root.querySelector('.scaler-value')!.textContent).toBe('6');
    expect(root.querySelector('.scaler-note')!.textContent).toBe('scaled ×1.5 from 4');
  });

  test('clamps the scaler to the 1..12 range', async () => {
    const { root } = await mountScreen();
    for (let i = 0; i < 5; i += 1) root.querySelector<HTMLElement>('.scaler-minus')!.click();
    expect(root.querySelector('.scaler-value')!.textContent).toBe('1');

    for (let i = 0; i < 15; i += 1) root.querySelector<HTMLElement>('.scaler-plus')!.click();
    expect(root.querySelector('.scaler-value')!.textContent).toBe('12');
    await waitForScaledFetch('12');
  });

  test('refetches with ?servings=N on scale and renders the API value, not a client-side multiply', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');

    expect(detailRequests).toContainEqual({ id: 'r1', servings: '6' });
    // Debounced to one extra call, not one per click — would be 2 if the
    // timer were gone (servings=5 then 6).
    expect(detailRequests.filter((r) => r.servings !== undefined)).toHaveLength(1);
    const quantities = [...root.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent);
    // 400*1.5=600 and 20*1.5=30 would be the naive (wrong) client-side answer.
    expect(quantities).toEqual(['605 g', '31 g']);
  });

  test('a failed scale fetch toasts and does not leave 6-serving chrome over 4-serving quantities', async () => {
    scale6 = () => jsonResponse(500, { error: 'cannot scale' });
    const { root } = await mountScreen();
    const baseQuantities = [...root.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent);
    expect(root.querySelector('.scaler-value')!.textContent).toBe('4');
    expect(baseQuantities).toEqual(['400 g', '20 g']);

    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');

    await vi.waitFor(() =>
      expect(document.querySelector('.toast')?.textContent).toMatch(/unexpected error/i),
    );
    expect(document.querySelector('.toast')?.className).toContain('toast-error');
    // Chrome and quantities stay aligned on the last successful recipe — not
    // 6-serving chrome over the unscaled 400 g / 20 g lines.
    expect(root.querySelector('.scaler-value')!.textContent).toBe('4');
    expect(root.querySelector('.scaler-note')!.textContent).toBe('base recipe');
    expect([...root.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent)).toEqual(
      baseQuantities,
    );
  });

  test('switching recipes while a scale fetch is in flight never paints r1 scaled lines on r2', async () => {
    let release!: (value: RecipeWithIngredients) => void;
    scale6 = () =>
      new Promise<RecipeWithIngredients>((resolve) => {
        release = resolve;
      });
    const { root } = await mountScreen();

    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');

    root.querySelector<HTMLElement>('[data-id="r2"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('h1')?.textContent).toBe('Ohrarisotto'));
    expect(root.querySelectorAll('.ingredient-qty')).toHaveLength(0);

    release(makeR1Scaled6());
    await flush(0);
    const detail = root.querySelector('.panel-pad')!;
    await vi.waitFor(() => expect(detail.querySelector('h1')?.textContent).toBe('Ohrarisotto'));
    // List still names Lohikeitto; the detail pane must not take r1's scaled
    // lines once r2 is selected.
    expect(detail.textContent).not.toContain('605');
    expect(detail.textContent).not.toContain('Salmon');
    expect([...detail.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent)).toEqual([]);
  });
});

describe('recipes screen — fork and edit', () => {
  test('forks a recipe into a new one carrying parentRecipeId and sourceType "forked"', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.fork-btn')!.click();
    await vi.waitFor(() => expect(postRequests).toHaveLength(1));
    expect(postRequests[0]!['parentRecipeId']).toBe('r1');
    expect(postRequests[0]!['sourceType']).toBe('forked');
  });

  test('an edit resends the full ingredient list, not just the changed line', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.edit-btn')!.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.edit-qty-input')).toHaveLength(2),
    );

    const qtyInputs = document.querySelectorAll<HTMLInputElement>('.edit-qty-input');
    qtyInputs[0]!.value = '999';

    document.querySelector<HTMLElement>('.modal-foot .btn-primary')!.click();
    await vi.waitFor(() => expect(patchRequests).toHaveLength(1));
    const sent = patchRequests[0]!.body.recipeIngredients;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ ingredientId: 'ing-salmon', quantity: '999' });
    expect(sent[1]).toMatchObject({ ingredientId: 'ing-dill', quantity: '20' });
  });

  test('an edit made while scaled to ×1.5 reads and persists unscaled quantities', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');
    expect(root.querySelector('.scaler-note')!.textContent).toBe('scaled ×1.5 from 4');

    root.querySelector<HTMLElement>('.edit-btn')!.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.edit-qty-input')).toHaveLength(2),
    );

    // The edit form must show the true base quantities (400/20), not 605/31.
    const qtyInputs = document.querySelectorAll<HTMLInputElement>('.edit-qty-input');
    expect(qtyInputs[0]!.value).toBe('400');
    expect(qtyInputs[1]!.value).toBe('20');

    document.querySelector<HTMLElement>('.modal-foot .btn-primary')!.click();
    await vi.waitFor(() => expect(patchRequests.length).toBeGreaterThan(0));

    const sent = patchRequests[patchRequests.length - 1]!.body.recipeIngredients;
    expect(sent[0]).toMatchObject({ quantity: '400' });
    expect(sent[1]).toMatchObject({ quantity: '20' });
  });
});
