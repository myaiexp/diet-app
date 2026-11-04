// Recipe import screen: matched-ingredient names and catalog candidate picking

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { importScreen } from '../screens/import/index.js';
import { jsonResponse, makeCtx, mountRoot, pathOf } from './harness.js';
import { makeDraft, makeIngredient, makeLine } from './fixtures.js';
import { draftFetch, submit, waitForReview, type PostedRecipe } from './import-test-helpers.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => resetClient());

describe('recipe import screen', () => {
  test('an ambiguous line says so, and must be picked like an unmatched one', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'paprika', ingredientId: null, ingredientName: null, quantity: 100, match: 'ambiguous' }),
      ],
    });
    fetchMock.mockImplementation(draftFetch(draft, 1));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    expect(root.querySelector('.import-line-bind .label-muted')!.textContent).toBe(
      '→ several catalog matches',
    );
    expect(root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!.disabled).toBe(true);
  });

  test('a bound line with no resolved name falls back to the generic label', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'mystery', ingredientId: 'ing-x', ingredientName: null, quantity: 10, match: 'exact' }),
      ],
    });
    fetchMock.mockImplementation(draftFetch(draft, 0));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    expect(root.querySelector('.import-line-bind .label-muted')!.textContent).toBe('→ catalog match');
  });

  test('picking a candidate names the ingredient the user chose', async () => {
    const draft = makeDraft({
      ingredients: [makeLine({ rawName: 'metsäsieniä', ingredientId: null, ingredientName: null, quantity: 250, unit: 'g', match: 'none' })],
    });
    const hit = makeIngredient({ id: 'ing-mush', name: 'Mushroom, button' });
    fetchMock.mockImplementation(draftFetch(draft, 1, { '/api/ingredients': [hit] }));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);
    await vi.waitFor(() => {
      expect(
        [...root.querySelectorAll('.import-candidate-results .import-candidate-pick')].some(
          (b) => b.textContent === 'Mushroom, button',
        ),
      ).toBe(true);
    });

    [...root.querySelectorAll<HTMLButtonElement>('.import-candidate-results .import-candidate-pick')]
      .find((b) => b.textContent === 'Mushroom, button')!
      .click();

    expect(root.querySelector('.import-line-bind .label-muted')!.textContent).toBe('→ Mushroom, button');
  });

  test('expands an unresolved line into catalog candidates from searchIngredients', async () => {
    const draft = makeDraft({
      ingredients: [makeLine({ rawName: 'metsäsieniä', ingredientId: null, quantity: 250, unit: 'g', match: 'none' })],
    });
    const hit = makeIngredient({ id: 'ing-mush', name: 'Mushroom, button' });
    fetchMock.mockImplementation(
      draftFetch(draft, 1, {
        '/api/ingredients': ({ url }) => {
          expect(url.searchParams.get('q')).toBe('metsäsieniä');
          return [hit];
        },
      }),
    );

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);
    await vi.waitFor(() => {
      const names = [...root.querySelectorAll('.import-candidate-results .import-candidate-pick')].map((b) => b.textContent);
      expect(names).toContain('Mushroom, button');
    });
  });

  test('picking a catalog candidate binds the line and allows save', async () => {
    const draft = makeDraft({
      ingredients: [makeLine({ rawName: 'metsäsieniä', ingredientId: null, quantity: 250, unit: 'g', match: 'none' })],
    });
    const hit = makeIngredient({ id: 'ing-mush', name: 'Mushroom, button' });
    let posted: PostedRecipe | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 1 });
      if (path === '/api/ingredients') return jsonResponse(200, [hit]);
      if (path === '/api/recipes' && method === 'POST') {
        posted = JSON.parse(init!.body as string) as PostedRecipe;
        return jsonResponse(201, { id: 'r1' });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);
    await vi.waitFor(() => {
      expect(
        [...root.querySelectorAll('.import-candidate-results .import-candidate-pick')].some(
          (b) => b.textContent === 'Mushroom, button',
        ),
      ).toBe(true);
    });

    const pick = [...root.querySelectorAll<HTMLButtonElement>('.import-candidate-results .import-candidate-pick')].find(
      (b) => b.textContent === 'Mushroom, button',
    )!;
    pick.click();

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await vi.waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.ingredients).toEqual([
      { ingredientId: 'ing-mush', quantity: 250, unit: 'g', optional: false, notes: null },
    ]);
  });

  test('skipping a line removes it from the payload entirely', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'bound', ingredientId: 'ing-1', quantity: 100, unit: 'g', match: 'exact' }),
        makeLine({ rawName: 'skip me', ingredientId: null, quantity: 250, unit: 'g', match: 'none' }),
      ],
    });
    let posted: PostedRecipe | null = null;
    fetchMock.mockImplementation(
      draftFetch(draft, 1, {
        'POST /api/recipes': ({ json }) => {
          posted = json<PostedRecipe>();
          return jsonResponse(201, { id: 'r1' });
        },
      }),
    );

    const root = mountRoot();
    const ctx = makeCtx();
    await importScreen().mount(root, ctx);
    submit(root);
    await waitForReview(root);

    const skipBtn = [...root.querySelectorAll<HTMLButtonElement>('.import-candidates .btn')].find(
      (b) => b.textContent === 'skip line',
    )!;
    skipBtn.click();

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await vi.waitFor(() => {
      expect(posted).not.toBeNull();
      expect(ctx.navigate).toHaveBeenCalledWith('/recipes');
    });
    expect(posted!.ingredients).toEqual([{ ingredientId: 'ing-1', quantity: 100, unit: 'g', optional: false, notes: null }]);
  });

});
