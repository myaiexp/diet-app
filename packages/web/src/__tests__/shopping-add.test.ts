// Manual add modal: catalog pick, defaultUnit prefill, the POST body the
// unique index depends on, qty<=0 reject, and a 409 that stays open.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { shoppingScreen } from '../screens/shopping.js';
import type { ShoppingItem, ShoppingList, Ingredient } from '../api/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function flush(ms = 0): Promise<void> {
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
  return { setSubtitle: vi.fn(), navigate: vi.fn() };
}

function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-1',
    name: 'Leek',
    aliases: ['purjo'],
    category: 'produce',
    defaultUnit: 'pieces',
    nutritionPer100g: null,
    shelfLife: null,
    tags: null,
    isPantryStaple: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const POTATO = makeIngredient({
  id: 'ing-potato',
  name: 'Potato',
  aliases: ['peruna'],
  category: 'produce',
  defaultUnit: 'kg',
});

function makeItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: 'item-1',
    listId: 'list-1',
    ingredientId: 'ing-1',
    quantityNeeded: '400',
    quantityInPantry: '0',
    netToBuy: '400',
    category: 'produce',
    unit: 'g',
    source: 'generated',
    bought: false,
    customNote: null,
    ingredient: makeIngredient(),
    ...overrides,
  };
}

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: 'list-1',
    weekStarting: '2026-08-17',
    status: 'draft',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    items: [makeItem()],
    ...overrides,
  };
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
  await flush(250);

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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/shopping-lists/current' && method === 'GET') {
        return jsonResponse(200, makeList());
      }
      if (path === '/api/ingredients') {
        expect(new URL(url, 'http://x').searchParams.get('q')).toBe('peruna');
        return jsonResponse(200, [POTATO]);
      }
      if (path === '/api/shopping-lists/list-1/items' && method === 'POST') {
        return jsonResponse(
          200,
          makeItem({
            id: 'item-new',
            ingredientId: POTATO.id,
            quantityNeeded: '1',
            unit: 'kg',
            source: 'manual',
            ingredient: POTATO,
          }),
        );
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

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
    fetchMock.mockImplementation(async (url: string) => {
      const path = pathOf(url);
      if (path === '/api/shopping-lists/current') return jsonResponse(200, makeList());
      if (path === '/api/ingredients') return jsonResponse(200, [POTATO]);
      return jsonResponse(404, { error: 'unhandled' });
    });

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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/shopping-lists/current' && method === 'GET') {
        return jsonResponse(200, makeList());
      }
      if (path === '/api/ingredients') return jsonResponse(200, [POTATO]);
      if (path === '/api/shopping-lists/list-1/items' && method === 'POST') {
        return jsonResponse(409, {
          error: 'An item for this ingredient and unit already exists',
        });
      }
      return jsonResponse(404, { error: 'unhandled' });
    });

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
