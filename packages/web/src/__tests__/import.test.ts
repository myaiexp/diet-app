// Recipe import screen: paste → extracting → review, the three-state line
// classification, the save gate, candidate search, and the error mapping.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { importScreen } from '../screens/import/index.js';
import type { RecipeDraft, DraftIngredientLine, Ingredient } from '../api/types.js';

interface PostedLine {
  ingredientId: string | null;
  quantity: number;
  unit: string;
}
interface PostedRecipe {
  title: string;
  ingredients: PostedLine[];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function flush(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Fills the url field and clicks `extract draft`. */
function submit(root: HTMLElement, url = 'https://example.com/recipe'): void {
  const input = root.querySelector<HTMLInputElement>('.import-paste input')!;
  input.value = url;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector<HTMLButtonElement>('.import-paste .btn-primary')!.click();
}

function makeLine(overrides: Partial<DraftIngredientLine> = {}): DraftIngredientLine {
  return {
    rawName: '3 dl ohrasuurimoita',
    ingredientId: 'ing-barley',
    quantity: 300,
    unit: 'ml',
    optional: false,
    notes: null,
    match: 'exact',
    quantityInferred: false,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    title: 'Ohrarisotto metsäsienillä',
    sourceType: 'imported',
    sourceUrl: 'https://example.com/recipe',
    steps: ['Step one', 'Step two'],
    servings: 4,
    prepTime: 15,
    totalTime: 40,
    effortScore: 3,
    tags: ['oven'],
    cuisineType: 'Finnish',
    ingredients: [makeLine()],
    ...overrides,
  };
}

function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-x',
    name: 'Mushroom, button',
    aliases: null,
    category: 'produce',
    defaultUnit: 'g',
    nutritionPer100g: null,
    shelfLife: null,
    tags: null,
    isPantryStaple: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 0 });
      if (path === '/api/ingredients') return jsonResponse(200, []);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    expect(root.querySelector('.import-paste')).not.toBeNull();

    submit(root);

    // Extracting renders synchronously, before the network settles.
    expect(root.querySelector('.import-extracting')).not.toBeNull();
    expect(root.querySelectorAll('.shimmer')).toHaveLength(5);

    await flush();
    expect(root.querySelector('.import-review')).not.toBeNull();
  });

  test('classifies lines as bound / assumed / unresolved', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'bound line', ingredientId: 'ing-1', quantity: 100, match: 'exact', quantityInferred: false }),
        makeLine({ rawName: 'assumed line', ingredientId: 'ing-2', quantity: 150, match: 'alias', quantityInferred: true }),
        makeLine({ rawName: 'no match line', ingredientId: null, quantity: 250, match: 'none', quantityInferred: false }),
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
    await flush();

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
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 0 });
      if (path === '/api/ingredients') return jsonResponse(200, []);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await flush();

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
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 2 });
      if (path === '/api/ingredients') return jsonResponse(200, []);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await flush();

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
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 0 });
      if (path === '/api/ingredients') return jsonResponse(200, []);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await flush();

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(false);
    expect(root.querySelector('.import-line--assumed')).not.toBeNull();
  });

  test('expands an unresolved line into catalog candidates from searchIngredients', async () => {
    const draft = makeDraft({
      ingredients: [makeLine({ rawName: 'metsäsieniä', ingredientId: null, quantity: 250, unit: 'g', match: 'none' })],
    });
    const hit = makeIngredient({ id: 'ing-mush', name: 'Mushroom, button' });
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 1 });
      if (path === '/api/ingredients') {
        expect(new URL(url, 'http://x').searchParams.get('q')).toBe('metsäsieniä');
        return jsonResponse(200, [hit]);
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await flush();

    const names = [...root.querySelectorAll('.import-candidate-results .btn-sm')].map((b) => b.textContent);
    expect(names).toContain('Mushroom, button');
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
    await flush();

    const pick = [...root.querySelectorAll<HTMLButtonElement>('.import-candidate-results .btn-sm')].find(
      (b) => b.textContent === 'Mushroom, button',
    )!;
    pick.click();

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await flush();

    expect(posted).not.toBeNull();
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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 1 });
      if (path === '/api/ingredients') return jsonResponse(200, []);
      if (path === '/api/recipes' && method === 'POST') {
        posted = JSON.parse(init!.body as string) as PostedRecipe;
        return jsonResponse(201, { id: 'r1' });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    const ctx = makeCtx();
    await importScreen().mount(root, ctx);
    submit(root);
    await flush();

    const skipBtn = [...root.querySelectorAll<HTMLButtonElement>('.import-candidates .btn-ghost')].find(
      (b) => b.textContent === 'skip line',
    )!;
    skipBtn.click();

    const saveBtn = root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await flush();

    expect(posted).not.toBeNull();
    expect(posted!.ingredients).toEqual([{ ingredientId: 'ing-1', quantity: 100, unit: 'g', optional: false, notes: null }]);
    expect(ctx.navigate).toHaveBeenCalledWith('/recipes');
  });

  test('sends only ingredientId-bound lines to POST /recipes', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({ rawName: 'bound', ingredientId: 'ing-1', quantity: 100, unit: 'g', match: 'exact' }),
        makeLine({ rawName: 'assumed', ingredientId: 'ing-2', quantity: 150, unit: 'g', match: 'alias', quantityInferred: true }),
      ],
    });
    let posted: PostedRecipe | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 0 });
      if (path === '/api/ingredients') return jsonResponse(200, []);
      if (path === '/api/recipes' && method === 'POST') {
        posted = JSON.parse(init!.body as string) as PostedRecipe;
        return jsonResponse(201, { id: 'r1' });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await flush();

    root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!.click();
    await flush();

    expect(posted).not.toBeNull();
    expect(posted!.ingredients.length).toBeGreaterThan(0);
    for (const line of posted!.ingredients) {
      expect(typeof line.ingredientId).toBe('string');
      expect(line.ingredientId).not.toBeNull();
    }
  });

  test('renders 503 as the AI-not-configured message', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (pathOf(url) === '/api/recipes/import') return jsonResponse(503, { error: 'AI not configured' });
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await flush();

    expect(root.querySelector('.import-paste')).not.toBeNull();
    expect(root.textContent).toContain('AI import is not configured on the server.');
  });

  test('renders 502 as a retryable extraction failure', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (pathOf(url) === '/api/recipes/import') {
        return jsonResponse(502, { error: 'Recipe extraction failed' });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await flush();

    expect(root.querySelector('.import-paste')).not.toBeNull();
    expect(root.textContent).toContain('Recipe extraction failed');
    expect(root.textContent).toContain('nothing was saved');
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
    await flush();

    const ingredientCalls = (): number =>
      fetchMock.mock.calls.filter((c) => pathOf(c[0] as string) === '/api/ingredients').length;
    const before = ingredientCalls();
    expect(before).toBeGreaterThan(0);

    const qty = root.querySelector<HTMLInputElement>('.import-line--bound .import-qty')!;
    qty.value = '120';
    qty.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(50);

    expect(ingredientCalls()).toBe(before);
  });

  test('unmounting the import screen cancels an in-flight candidate search', async () => {
    let finish: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const draft = makeDraft({
      ingredients: [makeLine({ rawName: 'metsäsieniä', ingredientId: null, quantity: 250, match: 'none' })],
    });
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/recipes/import') return jsonResponse(200, { draft, unmatchedCount: 1 });
      if (path === '/api/ingredients') return pending;
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    const screen = importScreen();
    await screen.mount(root, makeCtx());
    submit(root);
    await flush();
    expect(root.querySelector('.import-review')).not.toBeNull();
    expect(screen.unmount).toEqual(expect.any(Function));

    screen.unmount!();
    finish(jsonResponse(200, [makeIngredient()]));
    await flush(20);

    expect(root.querySelector('.import-candidate-results')?.textContent ?? '').not.toContain('Potato');
  });
});
