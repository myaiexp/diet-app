// Add-modal shelf-life fallback: the 400 that reveals expiresDate.
// Edit/delete coverage lives in pantry-edit.test.ts (⋯ menu through the screen).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { openAddItemModal } from '../modals/pantry-form.js';
import type { PantryLocation } from '../api/types.js';
import { jsonResponse, pathOf, routeFetch } from './harness.js';
import { makeIngredient, makePantryItem } from './fixtures.js';

const NO_SHELF_LIFE =
  'expiresDate is required when ingredient has no shelf life for this location';

function spice(overrides: Parameters<typeof makeIngredient>[0] = {}) {
  return makeIngredient({
    name: 'Mystery spice',
    aliases: [],
    category: 'other',
    defaultUnit: 'g',
    ...overrides,
  });
}

function expiresField(): HTMLElement {
  const input = document.querySelector<HTMLInputElement>('.pantry-form input[type="date"]');
  if (!input) throw new Error('expires date input missing');
  const field = input.closest('.pantry-field');
  if (!(field instanceof HTMLElement)) throw new Error('expires field missing');
  return field;
}

function expiresInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('.pantry-form input[type="date"]');
  if (!input) throw new Error('expires date input missing');
  return input;
}

function locationSelect(): HTMLSelectElement {
  const sel = document.querySelector<HTMLSelectElement>('.pantry-form select');
  if (!sel) throw new Error('location select missing');
  return sel;
}

function clickSave(): void {
  document.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!.click();
}

function postedBodies(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter((c) => {
      const url = c[0] as string;
      const init = c[1] as RequestInit | undefined;
      return pathOf(url) === '/api/pantry' && (init?.method ?? 'GET') === 'POST';
    })
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);
}

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

describe('openAddItemModal shelf-life fallback', () => {
  test('no-shelf-life 400 reveals expiresDate; retry sends it', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'POST /api/pantry': ({ json }) => {
            const body = json<{ expiresDate?: string }>();
            if (!body.expiresDate) return jsonResponse(400, { error: NO_SHELF_LIFE });
            return jsonResponse(201, makePantryItem({ expiresDate: body.expiresDate }));
          },
        },
        { unmatched: '404' },
      ),
    );

    const onCreated = vi.fn();
    openAddItemModal({ onCreated }, spice());

    expect(expiresField().classList.contains('hidden')).toBe(true);

    clickSave();
    await vi.waitFor(() => {
      expect(expiresField().classList.contains('hidden')).toBe(false);
      expect(document.querySelector('.helper-error')?.textContent).toContain(NO_SHELF_LIFE);
      expect(postedBodies(fetchMock)[0]).not.toHaveProperty('expiresDate');
      expect(onCreated).not.toHaveBeenCalled();
    });

    expiresInput().value = '2026-12-31';
    clickSave();
    await vi.waitFor(() => {
      expect(postedBodies(fetchMock)[1]).toMatchObject({
        ingredientId: 'ing-1',
        expiresDate: '2026-12-31',
        location: 'fridge',
      });
      expect(onCreated).toHaveBeenCalledOnce();
    });
  });

  test('a different 400 does not reveal the expires field, and a typed date is not sent', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        { 'POST /api/pantry': jsonResponse(400, { error: 'Invalid reference' }) },
        { unmatched: '404' },
      ),
    );

    openAddItemModal({ onCreated: vi.fn() }, spice());
    clickSave();
    await vi.waitFor(() => {
      expect(expiresField().classList.contains('hidden')).toBe(true);
      expect(document.querySelector('.helper-error')?.textContent).toContain('Invalid reference');
    });

    expiresInput().value = '2026-12-31';
    clickSave();
    await vi.waitFor(() => expect(postedBodies(fetchMock)).toHaveLength(2));

    for (const body of postedBodies(fetchMock)) {
      expect(body).not.toHaveProperty('expiresDate');
    }
    expect(expiresField().classList.contains('hidden')).toBe(true);
  });

  test('changing location after reveal still sends the filled expiresDate', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'POST /api/pantry': ({ json }) => {
            const body = json<{ expiresDate?: string; location?: PantryLocation }>();
            if (!body.expiresDate) return jsonResponse(400, { error: NO_SHELF_LIFE });
            return jsonResponse(
              201,
              makePantryItem({ expiresDate: body.expiresDate, location: body.location ?? 'fridge' }),
            );
          },
        },
        { unmatched: '404' },
      ),
    );

    const onCreated = vi.fn();
    openAddItemModal({ onCreated }, spice());
    clickSave();
    await vi.waitFor(() => expect(expiresField().classList.contains('hidden')).toBe(false));

    locationSelect().value = 'freezer';
    expiresInput().value = '2026-11-01';
    clickSave();
    await vi.waitFor(() => {
      expect(postedBodies(fetchMock)[1]).toMatchObject({
        location: 'freezer',
        expiresDate: '2026-11-01',
      });
      expect(onCreated).toHaveBeenCalledOnce();
    });
  });
});
