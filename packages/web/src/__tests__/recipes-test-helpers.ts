// Fixtures, stateful fetch router and mount helper for the recipes suites

import { vi, expect } from 'vitest';
import { recipesScreen } from '../screens/recipes/index.js';
import type { PantryItem, RecipeLineInput, RecipeWithIngredients } from '../api/types.js';
import { jsonResponse, makeCtx, mountRoot, routeFetch } from './harness.js';
import { makeIngredient, makePantryItem, makeRecipe } from './fixtures.js';

export const ING_SALMON = makeIngredient({
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

export function makeR1(): RecipeWithIngredients {
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
export function makeR1Scaled6(): RecipeWithIngredients {
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

/** servings=5 counterpart of makeR1Scaled6, for the out-of-order scale test. */
export function makeR1Scaled5(): RecipeWithIngredients {
  const base = makeR1();
  return {
    ...base,
    servings: 5,
    baseServings: 4,
    recipeIngredients: [
      { ...base.recipeIngredients[0]!, quantity: '503' },
      { ...base.recipeIngredients[1]!, quantity: '26' },
    ],
  };
}

export function makeR2(): RecipeWithIngredients {
  return {
    id: 'r2', title: 'Ohrarisotto', sourceType: 'imported', sourceUrl: 'https://example.com', parentRecipeId: null,
    steps: ['Toast the barley.'], prepTime: 15, totalTime: 40, servings: 4, effortScore: 3,
    tags: ['vegetarian', 'oven'], cuisineType: 'Finnish', userRating: 4, timesCooked: 2,
    createdAt: 't', updatedAt: 't', recipeIngredients: [],
  };
}

export function makeR3(): RecipeWithIngredients {
  return {
    id: 'r3', title: 'Uunilohi', sourceType: 'ai', sourceUrl: null, parentRecipeId: null,
    steps: ['Roast.'], prepTime: 10, totalTime: 45, servings: 4, effortScore: 1, tags: ['oven'],
    cuisineType: 'Finnish', userRating: 4, timesCooked: 1, createdAt: 't', updatedAt: 't',
    recipeIngredients: [],
  };
}

export function makeR4(): RecipeWithIngredients {
  return {
    id: 'r4', title: 'Karjalanpaisti (fork)', sourceType: 'forked', sourceUrl: null, parentRecipeId: 'r-orig',
    steps: ['Simmer.'], prepTime: 20, totalTime: 190, servings: 6, effortScore: 2, tags: [],
    cuisineType: 'Finnish', userRating: 5, timesCooked: 3, createdAt: 't', updatedAt: 't',
    recipeIngredients: [],
  };
}

export const PANTRY: PantryItem[] = [
  makePantryItem({ id: 'p1', ingredientId: 'ing-salmon', ingredient: ING_SALMON }),
];

export let recipesById: Map<string, RecipeWithIngredients>;
export let recipeRequests: Array<{ tags?: string }>;
export let detailRequests: Array<{ id: string; servings?: string }>;
export let patchRequests: Array<{ id: string; body: RecipeWithIngredients }>;
export let postRequests: Array<Record<string, unknown>>;
export let pantryRequestCount: number;
let idCounter: number;
/** Per-test overrides for GET /recipes/r1?servings=N (an object so importers can assign). */
export const fx: {
  /** Override servings=6 — default returns the non-naive scaled fixture. */
  scale6: () => RecipeWithIngredients | Response | Promise<RecipeWithIngredients | Response>;
  /** Override servings=5 — null serves the unscaled recipe. */
  scale5: (() => Promise<RecipeWithIngredients>) | null;
} = { scale6: () => makeR1Scaled6(), scale5: null };

export async function waitForScaledFetch(servings: string): Promise<void> {
  await vi.waitFor(() => {
    expect(detailRequests.some((r) => r.servings === servings)).toBe(true);
  });
}

export function resetFixtures(): void {
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
  fx.scale6 = () => makeR1Scaled6();
  fx.scale5 = null;
}

export function appRouter() {
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
      if (id === 'r1' && servings === '6') return fx.scale6();
      if (id === 'r1' && servings === '5' && fx.scale5) return fx.scale5();
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

export async function mountScreen(): Promise<{ root: HTMLElement; ctx: ReturnType<typeof makeCtx> }> {
  const root = mountRoot();
  const ctx = makeCtx();
  await recipesScreen().mount(root, ctx);
  return { root, ctx };
}
