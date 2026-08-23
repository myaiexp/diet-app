// Pantry ⋯ menu: PATCH fields update the row; delete removes it or leaves it.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { pantryScreen } from '../screens/pantry/index.js';
import type { PantryItem, PantryLocation, PantryPatch } from '../api/types.js';
import { flush, jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeIngredient, makePantryItem } from './fixtures.js';

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

function milkItem(overrides: Partial<PantryItem> = {}): PantryItem {
  return makePantryItem({
    id: 'item-1',
    quantity: '400',
    unit: 'g',
    location: 'fridge',
    opened: false,
    expiresDate: '2026-08-10',
    ingredient: makeIngredient({ name: 'Milk' }),
    ...overrides,
  });
}

function openRow(root: HTMLElement, name = 'Milk'): void {
  root.querySelector<HTMLButtonElement>(`[aria-label="edit ${name}"]`)!.click();
}

function fillEdit(fields: {
  quantity: string;
  unit: string;
  location: PantryLocation;
  opened: boolean;
  expiresDate: string;
}): void {
  const form = document.querySelector('.pantry-form')!;
  form.querySelector<HTMLInputElement>('input[type="number"]')!.value = fields.quantity;
  form.querySelector<HTMLInputElement>('input[type="text"]')!.value = fields.unit;
  form.querySelector<HTMLSelectElement>('select')!.value = fields.location;
  form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = fields.opened;
  form.querySelector<HTMLInputElement>('input[type="date"]')!.value = fields.expiresDate;
}

function clickSave(): void {
  document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
}

function clickDelete(): void {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.modal-foot .btn-ghost')].find(
    (b) => b.textContent === 'delete',
  );
  if (!btn) throw new Error('delete button missing');
  btn.click();
}

function methodCalls(method: string): Array<{ path: string; body?: Record<string, unknown> }> {
  return fetchMock.mock.calls
    .filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method)
    .map((c) => {
      const init = c[1] as RequestInit | undefined;
      const path = pathOf(c[0] as string);
      if (init?.body) return { path, body: JSON.parse(String(init.body)) as Record<string, unknown> };
      return { path };
    });
}

describe('pantry row ⋯ menu', () => {
  test('save PATCHes quantity/location/opened/expiresDate and updates the row', async () => {
    const item = milkItem();
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [item],
          'PATCH /api/pantry/:id': ({ json, params }) => {
            const body = json<PantryPatch>();
            return makePantryItem({
              ...item,
              id: params['id'],
              quantity: String(body.quantity),
              unit: body.unit,
              location: body.location,
              opened: body.opened,
              expiresDate: body.expiresDate,
            });
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);

    fillEdit({
      quantity: '250',
      unit: 'ml',
      location: 'freezer',
      opened: true,
      expiresDate: '2026-12-31',
    });
    clickSave();
    await flush(50);

    expect(methodCalls('PATCH')).toEqual([
      {
        path: '/api/pantry/item-1',
        body: {
          quantity: 250,
          unit: 'ml',
          location: 'freezer',
          opened: true,
          expiresDate: '2026-12-31',
        },
      },
    ]);
    expect(root.querySelector('.pantry-qty')?.textContent).toBe('250 ml');
    expect(root.querySelector('.row-meta')?.textContent).toContain('freezer');
    expect(root.querySelector('.label-muted')?.textContent).toBe('opened');
    expect(root.querySelectorAll('.pantry-row')).toHaveLength(1);
  });

  test('save without edits still PATCHes the seeded expiresDate and other fields', async () => {
    const item = milkItem();
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [item],
          'PATCH /api/pantry/:id': item,
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);

    const form = document.querySelector('.pantry-form')!;
    expect(form.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('400');
    expect(form.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-08-10');
    clickSave();
    await flush(50);

    expect(methodCalls('PATCH')).toEqual([
      {
        path: '/api/pantry/item-1',
        body: {
          quantity: 400,
          unit: 'g',
          location: 'fridge',
          opened: false,
          expiresDate: '2026-08-10',
        },
      },
    ]);
  });

  test('a 400 with fieldErrors renders quantity: must be positive and keeps the row', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [milkItem()],
          'PATCH /api/pantry/:id': jsonResponse(400, {
            error: 'Validation failed',
            details: { fieldErrors: { quantity: ['must be positive'] } },
          }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);
    clickSave();
    await flush(50);

    expect(root.querySelector('.row-title')?.textContent).toBe('Milk');
    expect(document.querySelector('.helper-error')?.textContent).toContain(
      'quantity: must be positive',
    );
    expect(document.querySelector('.modal-backdrop')).not.toBeNull();
  });

  test('delete DELETEs the item and removes the row from the list', async () => {
    const keep = milkItem({
      id: 'item-2',
      ingredientId: 'ing-2',
      ingredient: makeIngredient({ id: 'ing-2', name: 'Peas' }),
    });
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [milkItem(), keep],
          'DELETE /api/pantry/:id': new Response(null, { status: 204 }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    expect([...root.querySelectorAll('.row-title')].map((n) => n.textContent)).toEqual([
      'Milk',
      'Peas',
    ]);

    openRow(root, 'Milk');
    clickDelete();
    await flush(50);

    expect(methodCalls('DELETE')).toEqual([{ path: '/api/pantry/item-1' }]);
    expect([...root.querySelectorAll('.row-title')].map((n) => n.textContent)).toEqual(['Peas']);
    expect(document.querySelector('.modal-backdrop')).toBeNull();
  });

  test('a failed delete surfaces the error and leaves the row', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [milkItem()],
          'DELETE /api/pantry/:id': jsonResponse(500, { error: 'Internal' }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);
    clickDelete();
    await flush(50);

    expect(methodCalls('DELETE')).toEqual([{ path: '/api/pantry/item-1' }]);
    expect(root.querySelector('.row-title')?.textContent).toBe('Milk');
    expect(root.querySelector('.empty-state')).toBeNull();
    expect(document.querySelector('.helper-error')?.textContent).toContain('Nothing was saved');
    expect(document.querySelector('.modal-backdrop')).not.toBeNull();
  });
});
