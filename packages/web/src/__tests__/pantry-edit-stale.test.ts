// Pantry edit dialog against a row that moves while it is open: send only what changed, survive 409 and 404.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { pantryScreen } from '../screens/pantry/index.js';
import type { PantryItem, PantryLocation, PantryPatch } from '../api/types.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
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

describe('pantry edit against a moving row', () => {
  test('save without edits closes the dialog and writes nothing', async () => {
    fetchMock.mockImplementation(
      routeFetch({ 'GET /api/pantry': [milkItem()] }, { unmatched: '404' }),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);

    const form = document.querySelector('.pantry-form')!;
    expect(form.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('400');
    expect(form.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-08-10');
    clickSave();
    await vi.waitFor(() => expect(document.querySelector('.modal-backdrop')).toBeNull());
    expect(methodCalls('PATCH')).toEqual([]);
  });

  test('editing only the location leaves quantity out, so a cook mid-dialog survives', async () => {
    const item = milkItem();
    fetchMock.mockImplementation(
      routeFetch(
        { 'GET /api/pantry': [item], 'PATCH /api/pantry/:id': item },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);
    fillEdit({
      quantity: '400',
      unit: 'g',
      location: 'freezer',
      opened: false,
      expiresDate: '2026-08-10',
    });
    clickSave();
    await vi.waitFor(() => {
      expect(methodCalls('PATCH')).toEqual([
        { path: '/api/pantry/item-1', body: { location: 'freezer' } },
      ]);
    });
  });

  test('a 409 refreshes the row and the baseline, so a second save can go through', async () => {
    const item = milkItem();
    const cooked = milkItem({ quantity: '150' });
    const saved = milkItem({ quantity: '300' });
    const patches: PantryPatch[] = [];
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [item],
          'GET /api/pantry/:id': cooked,
          'PATCH /api/pantry/:id': ({ json }) => {
            patches.push(json<PantryPatch>());
            return patches.length === 1
              ? jsonResponse(409, { error: 'Quantity has changed' })
              : saved;
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);
    fillEdit({
      quantity: '300',
      unit: 'g',
      location: 'fridge',
      opened: false,
      expiresDate: '2026-08-10',
    });
    clickSave();
    await vi.waitFor(() => {
      expect(root.querySelector('.pantry-qty')?.textContent).toBe('150 g');
      expect(document.querySelector('.helper-error')?.textContent).toContain('150 g');
    });
    expect(patches).toEqual([{ quantity: 300, expectedQuantity: 400 }]);

    clickSave();
    await vi.waitFor(() => expect(root.querySelector('.pantry-qty')?.textContent).toBe('300 g'));
    expect(patches[1]).toEqual({ quantity: 300, expectedQuantity: 150 });
  });

  test('a 404 means a cook used the lot up: the row goes and the dialog closes', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/pantry': [milkItem()],
          'PATCH /api/pantry/:id': jsonResponse(404, { error: 'Not found' }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);
    fillEdit({
      quantity: '300',
      unit: 'g',
      location: 'fridge',
      opened: false,
      expiresDate: '2026-08-10',
    });
    clickSave();
    await vi.waitFor(() => {
      expect(root.querySelector('.pantry-row')).toBeNull();
      expect(document.querySelector('.modal-backdrop')).toBeNull();
    });
  });

  test('a unit-only edit sends just the unit, so the API rescales the stored amount', async () => {
    const item = milkItem({ quantity: '0.5', unit: 'kg' });
    const rescaled = milkItem({ quantity: '500', unit: 'g' });
    fetchMock.mockImplementation(
      routeFetch(
        { 'GET /api/pantry': [item], 'PATCH /api/pantry/:id': rescaled },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await pantryScreen().mount(root, makeCtx());
    openRow(root);
    fillEdit({
      quantity: '0.5',
      unit: 'g',
      location: 'fridge',
      opened: false,
      expiresDate: '2026-08-10',
    });
    clickSave();
    await vi.waitFor(() => {
      expect(methodCalls('PATCH')).toEqual([{ path: '/api/pantry/item-1', body: { unit: 'g' } }]);
      expect(root.querySelector('.pantry-qty')?.textContent).toBe('500 g');
    });
  });
});
