// Recipe import screen: paste → extracting → review, warnings, line classes

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { importScreen } from '../screens/import/index.js';
import { makeCtx, mountRoot, routeFetch } from './harness.js';
import { makeDraft, makeLine } from './fixtures.js';
import { draftFetch, submit, waitForReview } from './import-test-helpers.js';

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

  test('warns on review when the page yielded almost no text (idea #4087)', async () => {
    // The JS-hydrated case: the server answered 200, so the user sees a draft
    // built from a nav bar. Without this the empty result looks like the AI
    // failing, and the real cause — the page needs a browser — never surfaces.
    const draft = makeDraft();
    fetchMock.mockImplementation(
      routeFetch(
        {
          '/api/recipes/import': {
            draft,
            unmatchedCount: 0,
            truncated: false,
            lowYield: true,
          },
          '/api/ingredients': [],
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    const warn = root.querySelector('.import-low-yield');
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toMatch(/javascript/i);
    expect(root.querySelector('.import-truncated')).toBeNull();
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

  test('a bound line names the catalog ingredient it matched', async () => {
    const draft = makeDraft({
      ingredients: [
        makeLine({
          rawName: '3 dl ohrasuurimoita',
          ingredientId: 'ing-barley',
          ingredientName: 'Pearl barley',
          quantity: 300,
          match: 'exact',
        }),
        makeLine({ rawName: 'metsäsieniä', ingredientId: null, ingredientName: null, quantity: 250, match: 'none' }),
      ],
    });
    fetchMock.mockImplementation(draftFetch(draft, 1));

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await waitForReview(root);

    const binds = [...root.querySelectorAll('.import-line-bind .label-muted')].map((s) => s.textContent);
    expect(binds).toEqual(['→ Pearl barley', '→ no catalog match']);
  });

});
