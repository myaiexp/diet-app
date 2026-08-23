// Recipe import screen: paste → extracting → review, the three-state line
// classification, the save gate, candidate search, and the error mapping.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { importScreen } from '../screens/import/index.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeDraft, makeIngredient, makeLine } from './fixtures.js';

interface PostedLine {
  ingredientId: string | null;
  quantity: number;
  unit: string;
}
interface PostedRecipe {
  title: string;
  ingredients: PostedLine[];
}

/** Fills the url field and clicks `extract draft`. */
function submit(root: HTMLElement, url = 'https://example.com/recipe'): void {
  const input = root.querySelector<HTMLInputElement>('.import-paste input')!;
  input.value = url;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector<HTMLButtonElement>('.import-paste .btn-primary')!.click();
}

async function waitForReview(root: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(root.querySelector('.import-review')).not.toBeNull());
}

function draftFetch(
  draft: ReturnType<typeof makeDraft>,
  unmatchedCount = 0,
  extra: Parameters<typeof routeFetch>[0] = {},
) {
  return routeFetch(
    {
      '/api/recipes/import': { draft, unmatchedCount },
      '/api/ingredients': [],
      ...extra,
    },
    { unmatched: '404' },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => resetClient());

describe('recipe import screen', () => {
  test('moves paste → extracting → review on submit', async () => {
    const draft = makeDraft();
    fetchMock.mockImplementation(draftFetch(draft, 0));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    expect(root.querySelector('.import-paste')).not.toBeNull();

    submit(root);

    // Extracting renders synchronously, before the network settles.
    expect(root.querySelector('.import-extracting')).not.toBeNull();
    expect(root.querySelectorAll('.shimmer')).toHaveLength(5);

    await waitForReview(root);
    expect(root.querySelector('.import-truncated')).toBeNull();
  });

  test('shows a truncation warning on review when the import was truncated', async () => {
    const draft = makeDraft();
    fetchMock.mockImplementation(
      routeFetch(
        {
          '/api/recipes/import': { draft, unmatchedCount: 0, truncated: true },
          '/api/ingredients': [],
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    const warn = root.querySelector('.import-truncated');
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toMatch(/truncated/i);
  });

  test('classifies lines as bound / assumed / unresolved', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'bound line', ingredientId: 'ing-1', quantity: 100, match: 'exact', quantityInferred: false }),
        makeLine({ rawName: 'assumed line', ingredientId: 'ing-2', quantity: 150, match: 'alias', quantityInferred: true }),
        makeLine({ rawName: 'no match line', ingredientId: null, quantity: 250, match: 'none', quantityInferred: false }),
      ],
    });
    fetchMock.mockImplementation(draftFetch(draft, 1));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    const classes = [...root.querySelectorAll('.import-line')].map((r) => r.className);
    expect(classes).toEqual([
      'import-line import-line--bound',
      'import-line import-line--assumed',
      'import-line import-line--unresolved',
    ]);

    const head = root.querySelector('.import-lines-head')!;
    expect(head.querySelector('.label-green')?.textContent).toBe('1 bound');
    expect(head.querySelector('.label-orange')?.textContent).toBe('1 assumed');
    expect(head.querySelector('.label-red')?.textContent).toBe('1 need you');
  });

  test('an assumed line is NOT inferred from a round number', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'round qty', ingredientId: 'ing-1', quantity: 100, quantityInferred: false, match: 'alias' }),
      ],
    });
    fetchMock.mockImplementation(draftFetch(draft, 0));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    expect(root.querySelector('.import-line')!.className).toBe('import-line import-line--bound');
  });

  test('blocks save while any line is unresolved', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'bound', ingredientId: 'ing-1', quantity: 100, match: 'exact' }),
        makeLine({ rawName: 'unmatched a', ingredientId: null, quantity: 250, match: 'none' }),
        makeLine({ rawName: 'unmatched b', ingredientId: null, quantity: 10, match: 'none' }),
      ],
    });
    fetchMock.mockImplementation(draftFetch(draft, 2));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(true);
    const helper = root.querySelector('.import-footer .helper-error')!;
    expect(helper.classList.contains('hidden')).toBe(false);
    expect(helper.textContent).toContain('2 unresolved lines block saving — resolve or skip them.');
  });

  test('allows save with assumed lines, but keeps them visibly flagged', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'bound', ingredientId: 'ing-1', quantity: 100, match: 'exact' }),
        makeLine({ rawName: 'assumed', ingredientId: 'ing-2', quantity: 150, match: 'alias', quantityInferred: true }),
      ],
    });
    fetchMock.mockImplementation(draftFetch(draft, 0));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(false);
    expect(root.querySelector('.import-line--assumed')).not.toBeNull();
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
      const names = [...root.querySelectorAll('.import-candidate-results .btn-sm')].map((b) => b.textContent);
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
        [...root.querySelectorAll('.import-candidate-results .btn-sm')].some(
          (b) => b.textContent === 'Mushroom, button',
        ),
      ).toBe(true);
    });

    const pick = [...root.querySelectorAll<HTMLButtonElement>('.import-candidate-results .btn-sm')].find(
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

    const skipBtn = [...root.querySelectorAll<HTMLButtonElement>('.import-candidates .btn-ghost')].find(
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

  test('skipping every unmatched line keeps save disabled with the empty-payload copy', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'mystery a', ingredientId: null, quantity: 250, unit: 'g', match: 'none' }),
        makeLine({ rawName: 'mystery b', ingredientId: null, quantity: 10, unit: 'g', match: 'none' }),
      ],
    });
    fetchMock.mockImplementation(draftFetch(draft, 2));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    const skipNext = (): void => {
      const skipBtn = [...root.querySelectorAll<HTMLButtonElement>('.import-candidates .btn-ghost')].find(
        (b) => b.textContent === 'skip line',
      );
      expect(skipBtn).toBeDefined();
      skipBtn!.click();
    };
    skipNext();
    skipNext();

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(true);
    expect(root.querySelector('.import-footer .helper-error')!.textContent).toContain(
      'Every line was skipped — add at least one ingredient to save.',
    );
    saveBtn.click();
    const recipePosts = fetchMock.mock.calls.filter(
      (c) => pathOf(c[0] as string) === '/api/recipes' && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(recipePosts).toHaveLength(0);
  });

  test('a 400 from POST /recipes keeps the review pane and shows field errors', async () => {
    const draft = makeDraft({
      ingredients: [makeLine({ rawName: 'bound', ingredientId: 'ing-1', quantity: 100, unit: 'g', match: 'exact' })],
    });
    fetchMock.mockImplementation(
      draftFetch(draft, 0, {
        'POST /api/recipes': jsonResponse(400, {
          error: 'Validation failed',
          details: { fieldErrors: { ingredients: ['At least one ingredient is required'] } },
        }),
      }),
    );

    const root = mountRoot();
    const ctx = makeCtx();
    await importScreen().mount(root, ctx);
    submit(root);
    await waitForReview(root);

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    await vi.waitFor(() => {
      expect(root.querySelector('.import-review')).not.toBeNull();
      expect(root.querySelector('.import-footer .helper-error')?.textContent).toContain(
        'ingredients: At least one ingredient is required',
      );
    });
    expect(ctx.navigate).not.toHaveBeenCalled();
    expect(saveBtn.disabled).toBe(false);
  });

  test('sends only ingredientId-bound lines to POST /recipes', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'bound', ingredientId: 'ing-1', quantity: 100, unit: 'g', match: 'exact' }),
        makeLine({ rawName: 'assumed', ingredientId: 'ing-2', quantity: 150, unit: 'g', match: 'alias', quantityInferred: true }),
      ],
    });
    let posted: PostedRecipe | null = null;
    fetchMock.mockImplementation(
      draftFetch(draft, 0, {
        'POST /api/recipes': ({ json }) => {
          posted = json<PostedRecipe>();
          return jsonResponse(201, { id: 'r1' });
        },
      }),
    );

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!.click();
    await vi.waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.ingredients.length).toBeGreaterThan(0);
    for (const line of posted!.ingredients) {
      expect(typeof line.ingredientId).toBe('string');
      expect(line.ingredientId).not.toBeNull();
    }
  });

  test('renders 503 as the AI-not-configured message', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        { '/api/recipes/import': jsonResponse(503, { error: 'AI not configured' }) },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await vi.waitFor(() => {
      expect(root.querySelector('.import-paste')).not.toBeNull();
      expect(root.textContent).toContain('AI import is not configured on the server.');
    });
  });

  test('renders 502 as a retryable extraction failure', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        { '/api/recipes/import': jsonResponse(502, { error: 'Recipe extraction failed' }) },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await vi.waitFor(() => {
      expect(root.querySelector('.import-paste')).not.toBeNull();
      expect(root.textContent).toContain('Recipe extraction failed');
      expect(root.textContent).toContain('nothing was saved');
    });
  });

  test('rebuilding rows does not re-issue a catalog search for unresolved lines', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'bound', ingredientId: 'ing-1', quantity: 100, match: 'exact' }),
        makeLine({ rawName: 'unmatched', ingredientId: null, quantity: 250, match: 'none' }),
      ],
    });
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 1 });
      if (path === '/api/ingredients') return jsonResponse(200, []);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    const ingredientCalls = (): number =>
      fetchMock.mock.calls.filter((c) => pathOf(c[0] as string) === '/api/ingredients').length;
    const before = ingredientCalls();
    expect(before).toBeGreaterThan(0);

    const qty = root.querySelector<HTMLInputElement>('.import-line--bound .import-qty')!;
    qty.value = '120';
    qty.dispatchEvent(new Event('change', { bubbles: true }));

    expect(ingredientCalls()).toBe(before);
  });

  test('unmounting the import screen cancels an in-flight candidate search', async () => {
    let finish: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    let ingredientsSettled = false;
    const draft = makeDraft({
      ingredients: [makeLine({ rawName: 'metsäsieniä', ingredientId: null, quantity: 250, match: 'none' })],
    });
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 1 });
      if (path === '/api/ingredients') {
        try {
          return await pending;
        } finally {
          ingredientsSettled = true;
        }
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    const screen = importScreen();
    await screen.mount(root, makeCtx());
    submit(root);
    await waitForReview(root);
    expect(screen.unmount).toEqual(expect.any(Function));

    screen.unmount!();
    finish(jsonResponse(200, [makeIngredient()]));
    await vi.waitFor(() => expect(ingredientsSettled).toBe(true));

    expect(root.querySelector('.import-candidate-results')?.textContent ?? '').not.toContain('Potato');
  });
});
