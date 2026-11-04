// Meal plan cell clicks: skip, cook modal, cooked-cell explanation

import './pin-sunday.js';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { planScreen } from '../screens/plan/index.js';
import { makeCtx, mountRoot, pathOf } from './harness.js';
import { makeEntry } from './fixtures.js';
import { buildRouter } from './plan-test-helpers.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  resetClient();
  closeModal();
});

describe('planned and cooked cell clicks', () => {
  test('mark skipped from a planned cell refreshes the grid to skipped', async () => {
    const entry = makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', freeformNote: 'Lohikeitto' });
    fetchMock.mockImplementation(buildRouter({ entries: [entry] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="planned"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.cook-skip')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.cook-skip')!.click();

    await vi.waitFor(() => expect(isModalOpen()).toBe(false));
    const patch = fetchMock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/meal-plans/e-planned' && (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patch).toBeTruthy();
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ status: 'skipped' });
    expect(root.querySelector('.plan-cell[data-status="skipped"]')).not.toBeNull();
    expect(root.querySelector('.plan-cell[data-status="planned"]')).toBeNull();
  });

  test('a cooked cell shows what was cooked, a planned cell what was planned', async () => {
    const planned = makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', servings: '2' });
    // Cooking no longer rewrites `servings`, so the cell has to read the actual
    // figure or a cooked cell would silently show the wrong number.
    const cooked = makeEntry({
      id: 'e-cooked',
      slot: 'lunch',
      status: 'cooked',
      servings: '2',
      actualServings: '5',
    });
    fetchMock.mockImplementation(buildRouter({ entries: [planned, cooked] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    const servOf = (status: string) =>
      root.querySelector(`.plan-cell[data-status="${status}"] .plan-cell-serv`)?.textContent;
    expect(servOf('cooked')).toBe('5 serv');
    expect(servOf('planned')).toBe('2 serv');
  });

  test('opens the cook modal from a planned cell', async () => {
    const entry = makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', freeformNote: 'Lohikeitto' });
    fetchMock.mockImplementation(buildRouter({ entries: [entry] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="planned"]')!.click();

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => pathOf(String(u)).endsWith('/cook-preview'))).toBe(true),
    );
    expect(isModalOpen()).toBe(true);
  });

  test('deduct & mark cooked from a planned cell POSTs /cook and flips the cell', async () => {
    const entry = makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', freeformNote: 'Lohikeitto' });
    fetchMock.mockImplementation(buildRouter({ entries: [entry] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    expect(root.querySelector('.plan-fill-stats')?.textContent).toMatch(/0 cooked/);

    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="planned"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.cook-commit')!.click();

    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            pathOf(String(url)) === '/api/meal-plans/e-planned/cook' &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );

    // Confirm is gone; cook-flow opens feedback on success. Skip it so the
    // grid is the only surface left — the cell already flipped via onEntryChanged.
    await vi.waitFor(() => expect(document.querySelector('.cook-chip-row')).not.toBeNull());
    expect(document.querySelector('.cook-commit')).toBeNull();
    expect(root.querySelector('.plan-cell[data-status="cooked"]')).not.toBeNull();
    expect(root.querySelector('.plan-cell[data-status="planned"]')).toBeNull();
    expect(root.querySelector('.plan-fill-stats')?.textContent).toMatch(/1 cooked/);

    document.querySelector<HTMLButtonElement>('.cook-feedback-skip')!.click();
    expect(isModalOpen()).toBe(false);
  });

  test('does not open the cook modal from a cooked cell, and explains why', async () => {
    const entry = makeEntry({ id: 'e-cooked', slot: 'lunch', status: 'cooked', freeformNote: 'Rahka bowl' });
    fetchMock.mockImplementation(buildRouter({ entries: [entry] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    const before = fetchMock.mock.calls.length;
    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="cooked"]')!.click();

    expect(isModalOpen()).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(document.querySelector('.toast')?.textContent).toMatch(/locked/i);
  });
});
