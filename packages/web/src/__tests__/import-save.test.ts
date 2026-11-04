// Recipe import screen: skipping lines, save payload, and error mapping.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { importScreen } from '../screens/import/index.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
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
      const skipBtn = [...root.querySelectorAll<HTMLButtonElement>('.import-candidates .btn')].find(
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

  test('sends an exact line and an assumed alias line, and nothing else', async () => {
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
    // An assumed line is still sent. A filter that dropped it, or that
    // forwarded rawName/match, would fail this and not a "every id is a string".
    expect(posted!.ingredients).toEqual([
      { ingredientId: 'ing-1', quantity: 100, unit: 'g', optional: false, notes: null },
      { ingredientId: 'ing-2', quantity: 150, unit: 'g', optional: false, notes: null },
    ]);
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
