// Cook confirm modal: deduction preview, shortfalls and servings stepper

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { openCookFlow } from '../modals/cook-flow.js';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import type { MealPlanEntry, RecipeWithIngredients } from '../api/types.js';

import { flush, jsonResponse, routeFetch } from './harness.js';
import { DEBOUNCE_MS } from '../modals/cook-confirm.js';
import {
  ENTRY,
  RECIPE,
  ingredientLine,
  buildRouter,
  callsMatching,
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
  test('renders the deduction table from the preview endpoint (names, lot provenance, amounts)', async () => {
    fetchMock.mockImplementation(buildRouter());
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-name')).not.toBeNull());

    expect(document.querySelector('.cook-item-name')!.textContent).toBe('Salmon');
    const lotInfo = document.querySelector('.cook-lot-info')!;
    expect(lotInfo.textContent).toContain('lot ');
    expect(lotInfo.textContent).toContain('expires today');
    expect(document.querySelector('.cook-lot-amount')!.textContent).toBe('−400 g');
    expect(document.querySelector('.cook-lot-left')!.textContent).toBe('100 g left');
    expect(document.querySelector('.cook-degraded')?.classList.contains('hidden')).toBe(true);
  });

  test('a failed pantry fetch still renders preview amounts and lets you commit', async () => {
    fetchMock.mockImplementation(buildRouter({ pantryStatus: 500 }));
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-lot-amount')).not.toBeNull());

    expect(document.querySelector('.cook-item-name')!.textContent).toBe('Salmon');
    expect(document.querySelector('.cook-lot-info')!.textContent).toBe('lot ?');
    expect(document.querySelector('.cook-lot-amount')!.textContent).toBe('−400 g');
    expect(document.querySelector('.cook-lot-left')!.textContent).toBe('100 g left');
    const degraded = document.querySelector('.cook-degraded')!;
    expect(degraded.classList.contains('hidden')).toBe(false);
    expect(degraded.textContent).toMatch(/pantry/i);

    click('.cook-commit');
    await vi.waitFor(() => expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(true));
  });

  test('a failed recipe fetch still renders preview amounts and lets you commit', async () => {
    fetchMock.mockImplementation(buildRouter({ recipeStatus: 500 }));
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-lot-amount')).not.toBeNull());

    expect(document.querySelector('.cook-item-name')!.textContent).toBe('salmon');
    expect(document.querySelector('.cook-item-shortfall')!.textContent).toContain('dill');
    expect(document.querySelector('.cook-lot-info')!.textContent).toContain('expires today');
    expect(document.querySelector('.modal-title')!.textContent).toBe('Cook');
    const degraded = document.querySelector('.cook-degraded')!;
    expect(degraded.classList.contains('hidden')).toBe(false);
    expect(degraded.textContent).toMatch(/recipe/i);

    click('.cook-commit');
    await vi.waitFor(() => expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(true));
  });

  test('renders a shortfall line as "not in pantry — buy first"', async () => {
    fetchMock.mockImplementation(buildRouter());
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-shortfall')).not.toBeNull());
    expect(document.querySelector('.cook-item-shortfall')!.textContent).toBe('Dill — not in pantry — buy first');
  });

  test('insufficient-stock count shortfalls use pieces, not pcs', async () => {
    const recipe: RecipeWithIngredients = {
      ...RECIPE,
      recipeIngredients: [ingredientLine('eggs', 'Eggs', '4')],
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && u.pathname === '/api/recipes/r1') return jsonResponse(200, recipe);
      if (method === 'GET' && u.pathname === '/api/pantry') return jsonResponse(200, []);
      if (method === 'GET' && u.pathname === '/api/meal-plans/e1/cook-preview') {
        return jsonResponse(200, {
          deductions: [],
          shortfalls: [
            {
              ingredientId: 'eggs',
              dimension: 'count',
              requested: 4,
              available: 1,
              reason: 'insufficient_stock',
            },
          ],
          servings: 4,
        });
      }
      throw new Error(`unhandled request: ${method} ${u.pathname}`);
    });

    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-shortfall')).not.toBeNull());
    expect(document.querySelector('.cook-item-shortfall')!.textContent).toBe('Eggs — short 3 pieces');
    expect(document.querySelector('.cook-item-shortfall')!.textContent).not.toMatch(/\bpcs\b/);
  });

  test('shows the irreversibility warning above the commit button', async () => {
    fetchMock.mockImplementation(buildRouter());
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-name')).not.toBeNull());
    const warning = document.querySelector('.cook-warning')!;
    const commit = document.querySelector('.cook-commit')!;
    expect(warning.textContent).toContain('4 servings');
    expect(warning.textContent).toMatch(/final/i);
    expect(warning.textContent).toMatch(/locks/i);
    expect(Boolean(warning.compareDocumentPosition(commit) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  test('re-previews when the in-modal servings stepper changes (debounced)', async () => {
    fetchMock.mockImplementation(buildRouter());
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-name')).not.toBeNull());
    click('.cook-step-plus'); // 4 -> 5
    click('.cook-step-plus'); // 5 -> 6

    await vi.waitFor(() => expect(calledWith('cook-preview?servings=6')).toBe(true));
    // Debounced to one extra call, not one per click: initial load + this one.
    expect(callsMatching('cook-preview')).toHaveLength(2);
  });

  test('closing mid-debounce does not fire a leftover cook-preview', async () => {
    fetchMock.mockImplementation(buildRouter());
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-name')).not.toBeNull());
    const initial = callsMatching('cook-preview').length;

    // Pin the delay itself: fake only timer APIs so AbortSignal.timeout stays
    // native, then close before the stepper's reload is due.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      click('.cook-step-plus');
      click('.cook-cancel');
      await flush(DEBOUNCE_MS);
      expect(isModalOpen()).toBe(false);
      expect(callsMatching('cook-preview')).toHaveLength(initial);
    } finally {
      vi.useRealTimers();
    }
  });

  test('sends the chosen servings in the cook body and never PATCHes the entry', async () => {
    fetchMock.mockImplementation(buildRouter());
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-name')).not.toBeNull());
    click('.cook-step-plus'); // 4 -> 5
    await vi.waitFor(() => expect(calledWith('cook-preview?servings=5')).toBe(true));

    click('.cook-commit');
    await vi.waitFor(() => expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(true));

    // The stepper picks what is actually cooked; the entry's planned servings is
    // the record of intent and must survive the cook untouched.
    expect(lastBody('/api/meal-plans/e1/cook', 'POST')).toEqual({ servings: 5 });
    expect(calledWith('/api/meal-plans/e1', 'PATCH')).toBe(false);
  });

  test('commits the entry servings when the stepper was never touched', async () => {
    fetchMock.mockImplementation(buildRouter());
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    click('.cook-commit');
    await vi.waitFor(() => expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(true));

    expect(lastBody('/api/meal-plans/e1/cook', 'POST')).toEqual({ servings: 4 });
    expect(calledWith('/api/meal-plans/e1', 'PATCH')).toBe(false);
  });

  test('a freeform entry previews as an empty plan without erroring', async () => {
    const freeform: MealPlanEntry = { ...ENTRY, id: 'e2', recipeId: null, substituteRecipeId: null, freeformNote: 'Leftovers' };
    fetchMock.mockImplementation(
      routeFetch({
        'GET /api/pantry': [],
        'GET /api/meal-plans/:id/cook-preview': { deductions: [], shortfalls: [], servings: 4 },
      }),
    );

    openCookFlow({ entry: freeform });

    await vi.waitFor(() => expect(document.querySelector('.cook-empty')).not.toBeNull());
    expect(document.querySelector('.cook-empty')!.textContent).toBe('nothing to deduct');
    expect(calledWith('/recipes/')).toBe(false);
  });
});
