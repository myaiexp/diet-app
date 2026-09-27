// Pantry screen stale guards: a load-more page or a post-create reload that
// settles after the user navigated away writes no DOM, subtitle or toast.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { pantryScreen } from '../screens/pantry/index.js';
import { jsonResponse, makeCtx, mountRoot, routeFetch, type RouteTable } from './harness.js';
import { makeIngredient, makePantryItem } from './fixtures.js';
import { FRESH_THEN_STALE, hold, settleWith, type TestCtx } from './stale-probe.js';

const XYLITOL = makeIngredient({ id: 'ing-x', name: 'Xylitol', aliases: [], defaultUnit: 'g' });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  closeModal();
  resetClient();
});

async function mountWith(routes: RouteTable): Promise<{ root: HTMLElement; ctx: TestCtx }> {
  fetchMock.mockImplementation(routeFetch(routes, { unmatched: '404' }));
  const root = mountRoot();
  const ctx = makeCtx();
  await pantryScreen().mount(root, ctx);
  return { root, ctx };
}

/** First page full (so load-more shows); every later page is held. */
async function mountForLoadMore(): Promise<{ root: HTMLElement; ctx: TestCtx; page: ReturnType<typeof hold<unknown>> }> {
  const page = hold<unknown>();
  const firstPage = Array.from({ length: 50 }, (_, i) => makePantryItem({ id: `p-${i}` }));
  const mounted = await mountWith({
    'GET /api/pantry': ({ url }) =>
      (url.searchParams.get('offset') ?? '0') === '0' ? firstPage : page.handler(),
  });
  [...mounted.root.querySelectorAll<HTMLElement>('.pantry-tail .btn')]
    .find((b) => b.textContent === 'load more')!
    .click();
  await page.requested();
  return { ...mounted, page };
}

/** Empty pantry; add one item through the modal — the reload after the create is held. */
async function mountForReload(): Promise<{ root: HTMLElement; ctx: TestCtx; reload: ReturnType<typeof hold<unknown>> }> {
  const reload = hold<unknown>();
  let pantryReads = 0;
  const mounted = await mountWith({
    'GET /api/pantry': () => (++pantryReads === 1 ? [] : reload.handler()),
    'GET /api/ingredients': [XYLITOL],
    'POST /api/pantry': makePantryItem({ ingredientId: XYLITOL.id, ingredient: XYLITOL }),
  });
  const input = mounted.root.querySelector<HTMLInputElement>('.pantry-search-wrap input')!;
  input.value = 'xyl';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('.pantry-search-result')).not.toBeNull());
  document.querySelector<HTMLElement>('.pantry-search-result')!.click();
  document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
  await reload.requested();
  return { ...mounted, reload };
}

describe.each(FRESH_THEN_STALE)('pantry screen, $mode when the call settles', ({ stale }) => {
  test('a load-more page that arrives', async () => {
    const { root, ctx, page } = await mountForLoadMore();

    const wrote = await settleWith(root, ctx, stale, () =>
      page.resolve([makePantryItem({ id: 'p-50' })]),
    );

    expect(wrote).toEqual({ dom: !stale, subtitle: !stale, toast: null });
  });

  test('a load-more page that fails', async () => {
    const { root, ctx, page } = await mountForLoadMore();

    const wrote = await settleWith(root, ctx, stale, () =>
      page.resolve(jsonResponse(500, { error: 'boom' })),
    );

    expect(wrote).toEqual({ dom: !stale, subtitle: !stale, toast: stale ? null : 'error' });
  });

  test('the reload after a create, arriving', async () => {
    const { root, ctx, reload } = await mountForReload();

    const wrote = await settleWith(root, ctx, stale, () =>
      reload.resolve([makePantryItem({ ingredientId: XYLITOL.id, ingredient: XYLITOL })]),
    );

    expect(wrote).toEqual({ dom: !stale, subtitle: !stale, toast: null });
  });

  test('the reload after a create, failing', async () => {
    const { root, ctx, reload } = await mountForReload();

    const wrote = await settleWith(root, ctx, stale, () =>
      reload.resolve(jsonResponse(500, { error: 'boom' })),
    );

    expect(wrote.toast).toBe(stale ? null : 'error');
  });
});
