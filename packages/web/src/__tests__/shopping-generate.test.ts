// Shopping screen: generate/complete skipped notices, optional chip, delete

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { shoppingScreen } from '../screens/shopping/index.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeShoppingItem, makeShoppingList } from './fixtures.js';
import './pin-fixture-week.js';
import { completedRow, clickComplete, confirmComplete } from './shopping-test-helpers.js';

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

describe('shopping screen', () => {
  test('generate surfaces a non-empty skipped array as a dismissible notice', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': jsonResponse(404, { error: 'Not found' }),
          'POST /api/shopping-lists/generate': {
            list: {
              id: 'list-9',
              weekStarting: '2026-08-17',
              status: 'draft',
              createdAt: '2026-08-17T00:00:00.000Z',
              updatedAt: '2026-08-17T00:00:00.000Z',
            },
            items: [makeShoppingItem({ id: 'item-1' })],
            skipped: [{ ingredientId: null, entryId: 'entry-1', reason: 'unknown_unit' }],
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.empty-state .btn-primary')!.click();

    await vi.waitFor(() => {
      expect(root.querySelector('.shopping-notice')).not.toBeNull();
      expect(root.textContent).toMatch(/skipped/i);
      expect(root.textContent).toMatch(/unknown unit/i);
    });
  });

  test('the include-optional chip sends includeOptional on the next generate', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({ items: [makeShoppingItem()] }),
          'POST /api/shopping-lists/generate': {
            list: makeShoppingList(),
            items: [makeShoppingItem()],
            skipped: [],
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    const chip = [...root.querySelectorAll<HTMLElement>('.chip')].find(
      (c) => c.textContent === 'include optional',
    )!;
    // Off by default — the API's own default, and the one the design settled on.
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    chip.click();

    const regenerate = [...root.querySelectorAll<HTMLElement>('.shopping-actions .btn')].find(
      (b) => b.textContent === 'regenerate',
    )!;
    regenerate.click();

    await vi.waitFor(() => {
      const generateCall = fetchMock.mock.calls.find(
        (c) => pathOf(c[0] as string) === '/api/shopping-lists/generate',
      );
      expect(generateCall).toBeTruthy();
      expect(JSON.parse((generateCall![1] as RequestInit).body as string)).toEqual({
        weekStarting: '2026-08-17',
        includeOptional: true,
      });
    });
  });

  test('deleting a generated row warns that regeneration brings it back', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            items: [makeShoppingItem({ source: 'generated' })],
          }),
          'DELETE /api/shopping-lists/items/:id': new Response(null, { status: 204 }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    root.querySelector<HTMLElement>('.shopping-remove-btn')!.click();

    // The reappearance is deliberate API behaviour (#3232, dismissed): the
    // toast is the only place the user could learn it.
    await vi.waitFor(() => {
      expect(document.querySelector('.toast')?.textContent).toMatch(/bring it back/i);
    });
  });

  test('a completion that skipped items says they did NOT reach the pantry', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            items: [makeShoppingItem({ bought: true })],
          }),
          'POST /api/shopping-lists/:id/complete': {
            list: completedRow(),
            added: [],
            skipped: [{ itemId: 'item-1', reason: 'no_shelf_life' }],
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    clickComplete(root);
    confirmComplete();

    // A skipped item was NOT written to the pantry — copy that implied it was
    // would send the user hunting for food that isn't there.
    await vi.waitFor(() => {
      const notice = root.querySelector('.shopping-notice')?.textContent ?? '';
      expect(notice).toMatch(/did not reach the pantry/i);
      expect(notice).not.toMatch(/were filed/i);
    });
  });
});
