// Shopping complete flow: confirm copy, success, 409, 500 and network failure.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { shoppingScreen } from '../screens/shopping/index.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeIngredient, makeShoppingItem, makeShoppingList } from './fixtures.js';
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

describe('shopping complete', () => {
  test('confirm copy counts bought rows that actually file (netToBuy > 0)', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            items: [
              makeShoppingItem({ id: 'file-me', bought: true, netToBuy: '400' }),
              makeShoppingItem({
                id: 'covered',
                bought: true,
                netToBuy: '0',
                quantityInPantry: '400',
                ingredient: makeIngredient({ id: 'ing-2', name: 'Milk' }),
              }),
              makeShoppingItem({
                id: 'unbought',
                bought: false,
                netToBuy: '200',
                ingredient: makeIngredient({ id: 'ing-3', name: 'Dill' }),
              }),
            ],
          }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    clickComplete(root);

    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.modal')?.textContent).toMatch(
      /1 item will be filed into the pantry\. This can't be undone\./,
    );
  });

  test('confirm copy is 0 items when every bought row is already fully covered', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            items: [
              makeShoppingItem({
                id: 'covered',
                bought: true,
                netToBuy: '0',
                quantityInPantry: '400',
              }),
            ],
          }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    clickComplete(root);

    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.modal')?.textContent).toMatch(
      /0 items will be filed into the pantry\. This can't be undone\./,
    );
  });

  test('a successful complete from a draft list toasts, marks the list read-only, and POSTs {}', async () => {
    // Generate leaves lists as draft; the client never PATCHes status to
    // 'shopping'. Complete is offered for any non-done list with bought items.
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            items: [makeShoppingItem({ bought: true, netToBuy: '400' })],
          }),
          'POST /api/shopping-lists/:id/complete': {
            list: completedRow(),
            added: [],
            skipped: [],
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    expect(root.querySelector('.shopping-actions .btn-primary')?.textContent).toBe('complete');
    clickComplete(root);
    expect(isModalOpen()).toBe(true);
    confirmComplete();

    await vi.waitFor(() => expect(isModalOpen()).toBe(false));
    expect(document.querySelector('.toast')?.textContent).toBe('Shopping list completed.');
    expect(document.querySelector('.toast')?.className).toContain('toast-success');

    expect(root.querySelector('.shopping-readonly-note')?.textContent).toMatch(/read-only/i);
    expect(root.querySelector('.shopping-notice')).toBeNull();
    expect([...root.querySelectorAll('.shopping-actions .btn')].some((b) => b.textContent === 'complete')).toBe(
      false,
    );
    expect(root.querySelector('.shopping-row-toggle')?.tagName).toBe('DIV');
    expect(root.querySelector('.shopping-remove-btn')).toBeNull();

    const completeCall = fetchMock.mock.calls.find(
      (c) =>
        pathOf(c[0] as string) === '/api/shopping-lists/list-1/complete' &&
        (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(completeCall).toBeTruthy();
    // Bodyless complete 400s — the API requires {}.
    expect(JSON.parse(String((completeCall![1] as RequestInit).body))).toEqual({});
  });

  test('a 409 already-completed toasts the conflict and leaves the confirm modal open', async () => {
    // status: 'shopping' is the unused mid-shop branch — the client never
    // PATCHes it — kept here so a regression that required draft would fail.
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            status: 'shopping',
            items: [makeShoppingItem({ bought: true })],
          }),
          'POST /api/shopping-lists/:id/complete': jsonResponse(409, {
            error: 'Shopping list already completed',
          }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    clickComplete(root);
    confirmComplete();

    await vi.waitFor(() =>
      expect(document.querySelector('.toast')?.textContent).toMatch(/already completed/i),
    );
    expect(document.querySelector('.toast')?.className).toContain('toast-error');
    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.modal-title')?.textContent).toBe('Complete shopping list');
    expect(root.querySelector('.shopping-readonly-note')).toBeNull();
  });

  test('a 500 leaves the confirm modal open and does not mark the list done', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            status: 'shopping',
            items: [makeShoppingItem({ bought: true })],
          }),
          'POST /api/shopping-lists/:id/complete': jsonResponse(500, { error: 'boom' }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    clickComplete(root);
    confirmComplete();

    await vi.waitFor(() =>
      expect(document.querySelector('.toast')?.textContent).toMatch(/unexpected error|nothing was saved/i),
    );
    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.modal-foot .btn-primary')?.textContent).toBe('complete');
    expect(root.querySelector('.shopping-readonly-note')).toBeNull();
  });

  test('a network failure leaves the confirm modal open', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            status: 'shopping',
            items: [makeShoppingItem({ bought: true })],
          }),
          'POST /api/shopping-lists/:id/complete': () => {
            throw new TypeError('Failed to fetch');
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    clickComplete(root);
    confirmComplete();

    await vi.waitFor(() =>
      expect(document.querySelector('.toast')?.textContent).toMatch(/never reached the server/i),
    );
    expect(isModalOpen()).toBe(true);
    expect(root.querySelector('.shopping-readonly-note')).toBeNull();
  });
});
