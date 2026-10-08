// Recipes screen stale guards: a tag filter or post-fork refresh that settles
// after the user navigated away writes no list and raises no toast. Unmount
// during the servings debounce must cancel the pending scale fetch.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { recipesScreen } from '../screens/recipes/index.js';
import type { RecipeWithIngredients } from '../api/types.js';
import { flush, jsonResponse, makeCtx, mountRoot, routeFetch, type RouteTable } from './harness.js';
import { makeRecipe } from './fixtures.js';
import { FRESH_THEN_STALE, hold, settleWith, type TestCtx } from './stale-probe.js';

// detail.ts's scaler debounce. Not exported: the file is at the line cap, and
// this test is what pins the delay the unmount case has to beat.
const SCALE_DEBOUNCE_MS = 150;

function full(over: Partial<RecipeWithIngredients> = {}): RecipeWithIngredients {
  return { ...makeRecipe(over), recipeIngredients: [], ...over };
}

const ORIGINAL = full({ id: 'r1', title: 'Lohikeitto', tags: ['fish'] });
const FILTERED = full({ id: 'r-filtered', title: 'ShouldNotLinger', tags: ['fish'] });
const FORKED = full({ id: 'r-fork', title: 'Lohikeitto (fork)', sourceType: 'forked', parentRecipeId: 'r1' });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  resetClient();
  vi.useRealTimers();
});

function servingsFetches(): number {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes('servings=')).length;
}

async function mountWith(routes: RouteTable): Promise<{ root: HTMLElement; ctx: TestCtx; screen: ReturnType<typeof recipesScreen> }> {
  fetchMock.mockImplementation(routeFetch(routes, { unmatched: '404' }));
  const root = mountRoot();
  const ctx = makeCtx();
  const screen = recipesScreen();
  await screen.mount(root, ctx);
  return { root, ctx, screen };
}

describe.each(FRESH_THEN_STALE)('recipes screen, $mode when the call settles', ({ stale }) => {
  test('a tag-chip reload that arrives', async () => {
    const retag = hold<RecipeWithIngredients[]>();
    const { root, ctx } = await mountWith({
      'GET /api/pantry': [],
      'GET /api/recipes': ({ url }) => (url.searchParams.has('tags') ? retag.handler() : [ORIGINAL]),
      'GET /api/recipes/:id': ({ params }) => full({ id: params['id'], title: params['id'] === 'r-filtered' ? FILTERED.title : ORIGINAL.title }),
    });

    root.querySelector<HTMLElement>('[data-tag="fish"]')!.click();
    await retag.requested();

    const wrote = await settleWith(root, ctx, stale, () => retag.resolve([FILTERED]));

    expect(wrote).toEqual({ dom: !stale, subtitle: false, toast: null });
    expect(root.textContent?.includes('ShouldNotLinger')).toBe(!stale);
  });

  test('a tag-chip reload that fails', async () => {
    const retag = hold<Response>();
    const { root, ctx } = await mountWith({
      'GET /api/pantry': [],
      'GET /api/recipes': ({ url }) => (url.searchParams.has('tags') ? retag.handler() : [ORIGINAL]),
      'GET /api/recipes/:id': ORIGINAL,
    });

    root.querySelector<HTMLElement>('[data-tag="fish"]')!.click();
    await retag.requested();

    const wrote = await settleWith(root, ctx, stale, () =>
      retag.resolve(jsonResponse(500, { error: 'boom' })),
    );

    expect(wrote.toast).toBe(stale ? null : 'error');
    expect(wrote.dom).toBe(false);
  });

  test('the list refresh after a fork, arriving', async () => {
    const refresh = hold<RecipeWithIngredients[]>();
    let lists = 0;
    const { root, ctx } = await mountWith({
      'GET /api/pantry': [],
      'GET /api/recipes': () => {
        lists += 1;
        return lists === 1 ? [ORIGINAL] : refresh.handler();
      },
      'GET /api/recipes/:id': ({ params }) => full({ id: params['id'], title: params['id'] === 'r-fork' ? FORKED.title : ORIGINAL.title }),
      'POST /api/recipes': FORKED,
    });

    root.querySelector<HTMLElement>('.fork-btn')!.click();
    await refresh.requested();

    const wrote = await settleWith(root, ctx, stale, () => refresh.resolve([ORIGINAL, FORKED]));

    expect(wrote).toEqual({ dom: !stale, subtitle: false, toast: null });
    expect(root.querySelector('.recipe-rows')!.textContent?.includes('(fork)')).toBe(!stale);
  });

  test('the list refresh after a fork, failing', async () => {
    const refresh = hold<Response>();
    let lists = 0;
    const { root, ctx } = await mountWith({
      'GET /api/pantry': [],
      'GET /api/recipes': () => {
        lists += 1;
        return lists === 1 ? [ORIGINAL] : refresh.handler();
      },
      'GET /api/recipes/:id': ORIGINAL,
      'POST /api/recipes': FORKED,
    });

    root.querySelector<HTMLElement>('.fork-btn')!.click();
    await refresh.requested();

    const wrote = await settleWith(root, ctx, stale, () =>
      refresh.resolve(jsonResponse(500, { error: 'boom' })),
    );

    expect(wrote.toast).toBe(stale ? null : 'error');
    expect(root.querySelector('.recipe-rows')!.textContent?.includes('(fork)')).toBe(false);
  });
});

describe('recipes screen servings debounce', () => {
  test('unmounting mid-debounce does not fetch ?servings=', async () => {
    const { root, screen } = await mountWith({
      'GET /api/pantry': [],
      'GET /api/recipes': [ORIGINAL],
      'GET /api/recipes/:id': ORIGINAL,
    });
    expect(servingsFetches()).toBe(0);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    screen.unmount?.();
    await flush(SCALE_DEBOUNCE_MS);
    expect(servingsFetches()).toBe(0);
  });

  test('the scale fetch fires once the debounce elapses', async () => {
    const { root } = await mountWith({
      'GET /api/pantry': [],
      'GET /api/recipes': [ORIGINAL],
      'GET /api/recipes/:id': ({ url }) =>
        url.searchParams.has('servings') ? full({ ...ORIGINAL, servings: 5 }) : ORIGINAL,
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await flush(SCALE_DEBOUNCE_MS - 1);
    expect(servingsFetches()).toBe(0);
    await flush(1);
    expect(servingsFetches()).toBe(1);
  });
});
