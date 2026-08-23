// Manual add modal: catalog pick, defaultUnit prefill, the POST body the
// unique index depends on, qty<=0 reject, and a 409 that stays open.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { shoppingScreen } from '../screens/shopping/index.js';
import { flush, jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeIngredient, makeShoppingItem, makeShoppingList } from './fixtures.js';

const POTATO = makeIngredient({
  id: 'ing-potato',
  name: 'Potato',
  aliases: ['peruna'],
  category: 'produce',
  defaultUnit: 'kg',
});

function makeList() {
  return makeShoppingList({ items: [makeShoppingItem()] });
}

let fetchMock: ReturnType<typeof vi.fn>;

function itemsPosts(): unknown[] {
  return fetchMock.mock.calls
    .filter(
      (c) =>
        pathOf(c[0] as string) === '/api/shopping-lists/list-1/items' &&
        (c[1] as RequestInit | undefined)?.method === 'POST',
    )
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

async function pickPotato(): Promise<void> {
  [...document.querySelectorAll<HTMLElement>('.shopping-actions .btn')]
    .find((b) => b.textContent === '+ add')!
    .click();

  const search = document.querySelector<HTMLInputElement>('.modal-body input[type="text"]')!;
  search.value = 'peruna';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() => {
    expect(document.querySelector('.pantry-search-result')).not.toBeNull();
  });

  document.querySelector<HTMLElement>('.pantry-search-result')!.click();
}

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

describe('shopping add modal', () => {
  test('prefills defaultUnit and POSTs ingredientId, quantityNeeded, unit', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeList(),
          'GET /api/ingredients': ({ url }) => {
            expect(url.searchParams.get('q')).toBe('peruna');
            return [POTATO];
          },
          'POST /api/shopping-lists/:id/items': makeShoppingItem({
            id: 'item-new',
            ingredientId: POTATO.id,
            quantityNeeded: '1',
            unit: 'kg',
            source: 'manual',
            ingredient: POTATO,
          }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());
    await pickPotato();

    const unitInput = document.querySelectorAll<HTMLInputElement>(
      '.pantry-form-detail input[type="text"]',
    )[0]!;
    expect(unitInput.value).toBe('kg');

    document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
    await flush(20);

    expect(itemsPosts()).toEqual([{ ingredientId: 'ing-potato', quantityNeeded: 1, unit: 'kg' }]);
    expect(isModalOpen()).toBe(false);
    expect(root.textContent).toMatch(/potato/i);
  });

  test('rejects quantity <= 0 without POSTing', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeList(),
          'GET /api/ingredients': [POTATO],
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());
    await pickPotato();

    document.querySelector<HTMLInputElement>('.pantry-form-detail input[type="number"]')!.value = '0';
    document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
    await flush(20);

    expect(itemsPosts()).toEqual([]);
    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.helper-error')?.textContent).toMatch(/positive number/i);
  });

  test('a 409 duplicate shows the API error and keeps the modal open', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeList(),
          'GET /api/ingredients': [POTATO],
          'POST /api/shopping-lists/:id/items': jsonResponse(409, {
            error: 'An item for this ingredient and unit already exists',
          }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());
    await pickPotato();

    document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
    await flush(20);

    expect(itemsPosts()).toHaveLength(1);
    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.helper-error')?.textContent).toMatch(
      /ingredient and unit already exists/i,
    );
  });
});
