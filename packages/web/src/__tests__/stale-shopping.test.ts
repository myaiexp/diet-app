// Shopping screen stale guards: a toggle, delete, generate, complete or add
// that settles after the user navigated away writes no DOM, subtitle or toast.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { shoppingScreen } from '../screens/shopping/index.js';
import { jsonResponse, makeCtx, mountRoot, routeFetch, type RouteTable } from './harness.js';
import { makeIngredient, makeShoppingItem, makeShoppingList } from './fixtures.js';
import { FRESH_THEN_STALE, hold, settleWith, type TestCtx } from './stale-probe.js';

const POTATO = makeIngredient({ id: 'ing-potato', name: 'Potato', aliases: ['peruna'], defaultUnit: 'kg' });

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
  await shoppingScreen().mount(root, ctx);
  return { root, ctx };
}

function clickAction(label: string): void {
  [...document.querySelectorAll<HTMLButtonElement>('.shopping-actions .btn')]
    .find((b) => b.textContent === label)!
    .click();
}

describe.each(FRESH_THEN_STALE)('shopping screen, $mode when the call settles', ({ stale }) => {
  test('a bought toggle that succeeds', async () => {
    const patch = hold<unknown>();
    const { root, ctx } = await mountWith({
      'GET /api/shopping-lists/current': makeShoppingList({ items: [makeShoppingItem({ bought: false })] }),
      'PATCH /api/shopping-lists/items/:id': patch.handler,
    });
    root.querySelector<HTMLElement>('.shopping-row-toggle')!.click();
    await patch.requested();

    const wrote = await settleWith(root, ctx, stale, () =>
      patch.resolve(makeShoppingItem({ bought: true })),
    );

    expect(wrote.dom).toBe(!stale);
  });

  test('a bought toggle that fails', async () => {
    const patch = hold<Response>();
    const { root, ctx } = await mountWith({
      'GET /api/shopping-lists/current': makeShoppingList({ items: [makeShoppingItem({ bought: false })] }),
      'PATCH /api/shopping-lists/items/:id': patch.handler,
    });
    root.querySelector<HTMLElement>('.shopping-row-toggle')!.click();
    await patch.requested();

    const wrote = await settleWith(root, ctx, stale, () =>
      patch.resolve(jsonResponse(500, { error: 'boom' })),
    );

    expect(wrote.dom).toBe(!stale);
    expect(wrote.toast).toBe(stale ? null : 'error');
  });

  test('a row delete that succeeds', async () => {
    const del = hold<Response>();
    const { root, ctx } = await mountWith({
      'GET /api/shopping-lists/current': makeShoppingList({
        items: [makeShoppingItem({ source: 'generated' })],
      }),
      'DELETE /api/shopping-lists/items/:id': del.handler,
    });
    root.querySelector<HTMLElement>('.shopping-remove-btn')!.click();
    await del.requested();

    const wrote = await settleWith(root, ctx, stale, () =>
      del.resolve(new Response(null, { status: 204 })),
    );

    expect(wrote).toEqual({ dom: !stale, subtitle: !stale, toast: stale ? null : 'warning' });
  });

  test('a row delete that fails', async () => {
    const del = hold<Response>();
    const { root, ctx } = await mountWith({
      'GET /api/shopping-lists/current': makeShoppingList({ items: [makeShoppingItem()] }),
      'DELETE /api/shopping-lists/items/:id': del.handler,
    });
    root.querySelector<HTMLElement>('.shopping-remove-btn')!.click();
    await del.requested();

    const wrote = await settleWith(root, ctx, stale, () =>
      del.resolve(jsonResponse(500, { error: 'boom' })),
    );

    expect(wrote.toast).toBe(stale ? null : 'error');
  });

  // runGenerate and the complete commit (header.ts) toast before handing the
  // result to the screen and have no ctx of their own, so these two cases pin
  // the screen's handlers — DOM and subtitle — not the toast.
  test('a first-run generate', async () => {
    const generate = hold<unknown>();
    const { root, ctx } = await mountWith({
      'GET /api/shopping-lists/current': jsonResponse(404, { error: 'Not found' }),
      'POST /api/shopping-lists/generate': generate.handler,
    });
    root.querySelector<HTMLButtonElement>('.empty-state .btn-primary')!.click();
    await generate.requested();

    const list = makeShoppingList();
    const wrote = await settleWith(root, ctx, stale, () =>
      generate.resolve({ list, items: [makeShoppingItem()], skipped: [] }),
    );

    expect(wrote.dom).toBe(!stale);
    expect(wrote.subtitle).toBe(!stale);
  });

  test('a list completion', async () => {
    const complete = hold<unknown>();
    const list = makeShoppingList({ items: [makeShoppingItem({ bought: true })] });
    const { root, ctx } = await mountWith({
      'GET /api/shopping-lists/current': list,
      'POST /api/shopping-lists/:id/complete': complete.handler,
    });
    clickAction('complete');
    document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
    await complete.requested();

    const { items: _items, ...row } = list;
    const wrote = await settleWith(root, ctx, stale, () =>
      complete.resolve({ list: { ...row, status: 'done' }, added: [], skipped: [] }),
    );

    expect(wrote.dom).toBe(!stale);
    expect(wrote.subtitle).toBe(!stale);
  });

  test('a hand-added item', async () => {
    const add = hold<unknown>();
    const { root, ctx } = await mountWith({
      'GET /api/shopping-lists/current': makeShoppingList({ items: [makeShoppingItem()] }),
      'GET /api/ingredients': [POTATO],
      'POST /api/shopping-lists/:id/items': add.handler,
    });
    clickAction('+ add');
    const search = document.querySelector<HTMLInputElement>('.modal-body input[type="text"]')!;
    search.value = 'peruna';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.pantry-search-result')).not.toBeNull());
    document.querySelector<HTMLElement>('.pantry-search-result')!.click();
    document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
    await add.requested();

    const wrote = await settleWith(root, ctx, stale, () =>
      add.resolve(
        makeShoppingItem({ id: 'item-new', ingredientId: POTATO.id, source: 'manual', ingredient: POTATO }),
      ),
    );

    expect(wrote.dom).toBe(!stale);
    expect(wrote.subtitle).toBe(!stale);
  });
});
