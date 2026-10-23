// Shopping screen when /current returns an earlier week's list: the notice
// that offers this week's generate, and regenerate withheld from the old week.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { shoppingScreen } from '../screens/shopping/index.js';
import { makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeShoppingItem, makeShoppingList } from './fixtures.js';
import './pin-fixture-week.js';

let fetchMock: ReturnType<typeof vi.fn>;

// The pin puts today in vk 34 (Wed 2026-08-19); this list is vk 33's.
const LAST_WEEK = '2026-08-10';
const TODAY = '2026-08-19';

function buttons(root: HTMLElement, text: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.btn')].filter((b) => b.textContent === text);
}

function generatePosts(): unknown[] {
  return fetchMock.mock.calls
    .filter((c) => pathOf(c[0] as string) === '/api/shopping-lists/generate')
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));
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

describe('shopping screen — an earlier week is current', () => {
  test("an open earlier list names its week and generates this week's for today", async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            weekStarting: LAST_WEEK,
            status: 'shopping',
            items: [makeShoppingItem({ bought: true })],
          }),
          'POST /api/shopping-lists/generate': {
            list: makeShoppingList({ id: 'list-2' }),
            items: [makeShoppingItem({ id: 'item-2' })],
            skipped: [],
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    const notice = root.querySelector('.shopping-carry-over')!;
    expect(notice.textContent).toMatch(/vk 33/);
    expect(notice.textContent).toMatch(/still open/i);
    // Completing it is still the way to file what was bought.
    expect(buttons(root, 'complete')).toHaveLength(1);

    buttons(root, "generate vk 34's list")[0]!.click();

    await vi.waitFor(() => {
      expect(generatePosts()).toEqual([{ weekStarting: TODAY, includeOptional: false }]);
      expect(root.querySelector('.shopping-carry-over')).toBeNull();
    });
  });

  test('a draft from an earlier week is not offered regenerate', async () => {
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/shopping-lists/current': makeShoppingList({
            weekStarting: LAST_WEEK,
            items: [makeShoppingItem()],
          }),
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    expect(buttons(root, 'regenerate')).toHaveLength(0);
    expect(root.querySelector('.shopping-actions')!.textContent).toMatch(/earlier week/i);
  });

  test("an emptied earlier list offers this week's generate, not regenerate", async () => {
    fetchMock.mockImplementation(
      routeFetch(
        { 'GET /api/shopping-lists/current': makeShoppingList({ weekStarting: LAST_WEEK, items: [] }) },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    expect(root.textContent).toMatch(/nothing to buy/i);
    expect(buttons(root, 'regenerate')).toHaveLength(0);
    expect(buttons(root, "generate vk 34's list")).toHaveLength(1);
  });

  test("this week's list carries no notice and keeps regenerate", async () => {
    fetchMock.mockImplementation(
      routeFetch(
        { 'GET /api/shopping-lists/current': makeShoppingList({ items: [makeShoppingItem()] }) },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await shoppingScreen().mount(root, makeCtx());

    expect(root.querySelector('.shopping-carry-over')).toBeNull();
    expect(buttons(root, 'regenerate')).toHaveLength(1);
  });
});
