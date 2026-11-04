// Cook confirm modal actions: commit, skip and error handling after cooking.

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { openCookFlow } from '../modals/cook-flow.js';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';

import { jsonResponse, routeFetch } from './harness.js';
import {
  ENTRY,
  RECIPE,
  PANTRY,
  buildRouter,
  calledWith,
  lastBody,
  click,
  setFetchMock,
} from './cook-flow-test-helpers.js';

let fetchMock: Mock;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  setFetchMock(fetchMock);
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  resetClient();
  closeModal();
});

describe('cook confirm', () => {
  test('opens the feedback modal after a successful cook', async () => {
    fetchMock.mockImplementation(buildRouter());
    const onEntryChanged = vi.fn();
    openCookFlow({ entry: ENTRY, onEntryChanged });

    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    click('.cook-commit');

    await vi.waitFor(() => expect(document.querySelector('.cook-chip-row')).not.toBeNull());
    expect(document.querySelector('.modal-title')!.textContent).toMatch(/^Cooked\. \d+ items deducted\.$/);
    expect(onEntryChanged).toHaveBeenCalledOnce();
    expect(onEntryChanged.mock.calls[0]![0]).toMatchObject({ status: 'cooked' });
  });

  test('mark skipped PATCHes status and refreshes the caller with the skipped entry', async () => {
    fetchMock.mockImplementation(buildRouter());
    const onEntryChanged = vi.fn();
    openCookFlow({ entry: ENTRY, onEntryChanged });

    await vi.waitFor(() => expect(document.querySelector('.cook-skip')).not.toBeNull());
    click('.cook-skip');

    await vi.waitFor(() => expect(isModalOpen()).toBe(false));
    expect(calledWith('/api/meal-plans/e1', 'PATCH')).toBe(true);
    expect(lastBody('/api/meal-plans/e1', 'PATCH')).toEqual({ status: 'skipped' });
    expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(false);
    expect(document.querySelector('.cook-chip-row')).toBeNull();
    expect(document.querySelector('.toast')?.textContent).toMatch(/skipped/i);
    expect(onEntryChanged).toHaveBeenCalledOnce();
    expect(onEntryChanged.mock.calls[0]![0]).toMatchObject({ id: 'e1', status: 'skipped' });
  });

  test('a failed skip leaves the modal up and does not fire onEntryChanged', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && u.pathname === '/api/meal-plans/e1') {
        return jsonResponse(500, { error: 'could not skip' });
      }
      return buildRouter()(input, init);
    });
    const onEntryChanged = vi.fn();
    openCookFlow({ entry: ENTRY, onEntryChanged });

    await vi.waitFor(() => expect(document.querySelector('.cook-skip')).not.toBeNull());
    click('.cook-skip');

    await vi.waitFor(() => expect(document.querySelector('.toast')?.textContent).toMatch(/could not skip|unexpected error/i));
    expect(isModalOpen()).toBe(true);
    expect(onEntryChanged).not.toHaveBeenCalled();
    expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(false);
  });

  test('surfaces a 409 from cook as "already cooked" and refreshes the entry', async () => {
    fetchMock.mockImplementation(buildRouter({ cookStatus: 409 }));
    const onEntryChanged = vi.fn();
    openCookFlow({ entry: ENTRY, onEntryChanged });

    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    click('.cook-commit');

    await vi.waitFor(() => expect(isModalOpen()).toBe(false));
    expect(document.querySelector('.toast')?.textContent?.toLowerCase()).toContain('already cooked');
    expect(onEntryChanged).toHaveBeenCalledOnce();
    expect(onEntryChanged.mock.calls[0]![0]).toMatchObject({ status: 'cooked' });
  });

  test('a failed cook at raised servings leaves the modal open and writes nothing', async () => {
    fetchMock.mockImplementation(buildRouter({ cookStatus: 500 }));
    const onEntryChanged = vi.fn();
    openCookFlow({ entry: ENTRY, onEntryChanged });

    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    click('.cook-step-plus');
    await vi.waitFor(() => expect(calledWith('cook-preview?servings=5')).toBe(true));

    click('.cook-commit');
    await vi.waitFor(() =>
      expect(document.querySelector('.toast')?.textContent).toMatch(/unexpected error|nothing was saved/i),
    );

    // One request, one outcome: a failed cook can no longer leave the entry
    // half-written the way the old PATCH-then-cook pair could.
    expect(lastBody('/api/meal-plans/e1/cook', 'POST')).toEqual({ servings: 5 });
    expect(calledWith('/api/meal-plans/e1', 'PATCH')).toBe(false);
    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.cook-commit')).not.toBeNull();
    expect(document.querySelector('.cook-chip-row')).toBeNull();
    expect(onEntryChanged).not.toHaveBeenCalled();
  });

  test('surfaces a 400 from an out-of-range cook servings without closing the modal', async () => {
    fetchMock.mockImplementation(buildRouter({ cookStatus: 400 }));
    const onEntryChanged = vi.fn();
    openCookFlow({ entry: ENTRY, onEntryChanged });

    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    click('.cook-commit');

    await vi.waitFor(() => expect(document.querySelector('.toast')).not.toBeNull());
    expect(isModalOpen()).toBe(true);
    expect(onEntryChanged).not.toHaveBeenCalled();
  });

  test('renders a unit_mismatch shortfall with dedicated copy', async () => {
    fetchMock.mockImplementation(
      routeFetch({
        'GET /api/recipes/:id': RECIPE,
        'GET /api/pantry': PANTRY,
        'GET /api/meal-plans/:id/cook-preview': {
          deductions: [],
          shortfalls: [
            {
              ingredientId: 'salmon',
              dimension: null,
              requested: 400,
              available: 0,
              reason: 'unit_mismatch',
            },
          ],
          servings: 4,
        },
      }),
    );

    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-shortfall')).not.toBeNull());
    expect(document.querySelector('.cook-item-shortfall')!.textContent).toBe(
      "Salmon — units don't convert (mass/volume/count only)",
    );
  });
});
