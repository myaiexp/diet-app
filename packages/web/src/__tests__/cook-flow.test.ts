// Cook confirm + feedback modals, driven through the public seam (cook-flow.ts).

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { openCookFlow, openFeedbackModal } from '../modals/cook-flow.js';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import type { MealPlanEntry, RecipeWithIngredients, PantryItem } from '../api/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function click(selector: string): void {
  const node = document.querySelector<HTMLButtonElement>(selector);
  if (!node) throw new Error(`selector not found: ${selector}`);
  node.click();
}

function isoDaysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ingredientLine(ingredientId: string, name: string, quantity: string) {
  return {
    id: `ri-${ingredientId}`,
    recipeId: 'r1',
    ingredientId,
    quantity,
    unit: 'g',
    optional: false,
    notes: null,
    ingredient: {
      id: ingredientId,
      name,
      aliases: null,
      category: 'misc',
      defaultUnit: 'g',
      nutritionPer100g: null,
      shelfLife: null,
      tags: null,
      isPantryStaple: null,
      createdAt: '',
      updatedAt: '',
    },
  };
}

const ENTRY: MealPlanEntry = {
  id: 'e1',
  date: '2026-08-04',
  slot: 'dinner',
  recipeId: 'r1',
  freeformNote: null,
  servings: '4',
  status: 'planned',
  substituteRecipeId: null,
  notes: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const RECIPE: RecipeWithIngredients = {
  id: 'r1',
  title: 'Lohikeitto',
  sourceType: 'manual',
  sourceUrl: null,
  parentRecipeId: null,
  steps: [],
  prepTime: null,
  totalTime: null,
  servings: 4,
  effortScore: null,
  tags: null,
  cuisineType: null,
  userRating: null,
  timesCooked: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  // salmon deducts from pantry row p1; dill is never in the pantry — a shortfall.
  recipeIngredients: [ingredientLine('salmon', 'Salmon', '400'), ingredientLine('dill', 'Dill', '10')],
};

const PANTRY: PantryItem[] = [
  {
    id: 'p1',
    ingredientId: 'salmon',
    quantity: '500',
    unit: 'g',
    location: 'fridge',
    addedDate: isoDaysFromNow(-2),
    expiresDate: isoDaysFromNow(0),
    opened: false,
    status: 'use_today',
    ingredient: {
      id: 'salmon',
      name: 'Salmon',
      aliases: ['lohi'],
      category: 'protein',
      defaultUnit: 'g',
      nutritionPer100g: null,
      shelfLife: null,
      tags: null,
      isPantryStaple: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

function deductionPlan(servings: number) {
  const scale = servings / 4;
  const after = 500 - 400 * scale;
  return {
    deductions: [
      {
        ingredientId: 'salmon',
        dimension: 'mass' as const,
        requested: 400 * scale,
        deducted: 400 * scale,
        pantryItems: [{ id: 'p1', unit: 'g', before: '500', after: String(after), deleted: after <= 0 }],
      },
    ],
    shortfalls: [
      { ingredientId: 'dill', dimension: 'mass' as const, requested: 10 * scale, available: 0, reason: 'not_in_pantry' as const },
    ],
  };
}

interface RouteOpts {
  cookStatus?: number;
}

/** Routes the entry-e1 flow: recipe, pantry, preview, PATCH, cook, feedback. */
function buildRouter(opts: RouteOpts = {}) {
  const state = { servings: 4 };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && u.pathname === '/api/recipes/r1') return jsonResponse(200, RECIPE);
    if (method === 'GET' && u.pathname === '/api/pantry') return jsonResponse(200, PANTRY);
    if (method === 'GET' && u.pathname === '/api/meal-plans/e1/cook-preview') {
      const servings = Number(u.searchParams.get('servings') ?? state.servings);
      return jsonResponse(200, { ...deductionPlan(servings), servings });
    }
    if (method === 'PATCH' && u.pathname === '/api/meal-plans/e1') {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { servings?: number; status?: MealPlanEntry['status'] })
        : {};
      if (typeof body.servings === 'number') state.servings = body.servings;
      return jsonResponse(200, {
        ...ENTRY,
        servings: String(state.servings),
        ...(body.status ? { status: body.status } : {}),
      });
    }
    if (method === 'POST' && u.pathname === '/api/meal-plans/e1/cook') {
      if (opts.cookStatus === 409) return jsonResponse(409, { error: 'Meal plan entry already cooked' });
      return jsonResponse(200, {
        entry: { ...ENTRY, status: 'cooked', servings: String(state.servings) },
        ...deductionPlan(state.servings),
      });
    }
    if (method === 'POST' && u.pathname === '/api/meal-plans/e1/feedback') {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(201, {
        id: 'fb1',
        mealPlanEntryId: 'e1',
        rating: 'thumbs_up',
        effortCheck: 'felt_right',
        makeAgain: 'yes',
        usedAsIs: true,
        changesNote: null,
        createdAt: '',
        updatedAt: '',
        ...body,
      });
    }
    throw new Error(`unhandled request: ${method} ${u.pathname}`);
  });
}

let fetchMock: Mock;

/** Calls whose URL contains `pattern`, optionally narrowed by HTTP method. */
function callsMatching(pattern: string, method?: string): Array<[string, RequestInit | undefined]> {
  return (fetchMock.mock.calls as Array<[unknown, RequestInit | undefined]>)
    .filter((c): c is [string, RequestInit | undefined] => typeof c[0] === 'string')
    .filter(([url, init]) => url.includes(pattern) && (!method || (init?.method ?? 'GET') === method));
}

function calledWith(pattern: string, method?: string): boolean {
  return callsMatching(pattern, method).length > 0;
}

function lastBody(pattern: string, method?: string): Record<string, unknown> {
  const calls = callsMatching(pattern, method);
  const [, init] = calls[calls.length - 1]!;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
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

  test('changing servings PATCHes the entry before committing the cook', async () => {
    fetchMock.mockImplementation(buildRouter());
    openCookFlow({ entry: ENTRY });

    await vi.waitFor(() => expect(document.querySelector('.cook-item-name')).not.toBeNull());
    click('.cook-step-plus'); // 4 -> 5
    await vi.waitFor(() => expect(calledWith('cook-preview?servings=5')).toBe(true));

    click('.cook-commit');
    await vi.waitFor(() => expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(true));

    const patchIndex = fetchMock.mock.calls.findIndex(
      ([url, init]) => url === '/api/meal-plans/e1' && (init as RequestInit)?.method === 'PATCH',
    );
    const postIndex = fetchMock.mock.calls.findIndex(
      ([url, init]) => url === '/api/meal-plans/e1/cook' && (init as RequestInit)?.method === 'POST',
    );
    expect(patchIndex).toBeGreaterThanOrEqual(0);
    expect(postIndex).toBeGreaterThan(patchIndex);
    expect(lastBody('/api/meal-plans/e1', 'PATCH')).toEqual({ servings: 5 });
  });

  test('a freeform entry previews as an empty plan without erroring', async () => {
    const freeform: MealPlanEntry = { ...ENTRY, id: 'e2', recipeId: null, substituteRecipeId: null, freeformNote: 'Leftovers' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && u.pathname === '/api/pantry') return jsonResponse(200, []);
      if (method === 'GET' && u.pathname === '/api/meal-plans/e2/cook-preview') {
        return jsonResponse(200, { deductions: [], shortfalls: [], servings: 4 });
      }
      throw new Error(`unhandled request: ${method} ${u.pathname}`);
    });

    openCookFlow({ entry: freeform });

    await vi.waitFor(() => expect(document.querySelector('.cook-empty')).not.toBeNull());
    expect(document.querySelector('.cook-empty')!.textContent).toBe('nothing to deduct');
    expect(calledWith('/recipes/')).toBe(false);
  });

  test('opens the feedback modal after a successful cook', async () => {
    fetchMock.mockImplementation(buildRouter());
    const onCooked = vi.fn();
    openCookFlow({ entry: ENTRY, onCooked });

    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    click('.cook-commit');

    await vi.waitFor(() => expect(document.querySelector('.cook-chip-row')).not.toBeNull());
    expect(document.querySelector('.modal-title')!.textContent).toMatch(/^Cooked\. \d+ items deducted\.$/);
    expect(onCooked).toHaveBeenCalledOnce();
    expect(onCooked.mock.calls[0]![0]).toMatchObject({ entry: { status: 'cooked' } });
  });

  test('mark skipped PATCHes status and refreshes the caller with the skipped entry', async () => {
    fetchMock.mockImplementation(buildRouter());
    const onCooked = vi.fn();
    openCookFlow({ entry: ENTRY, onCooked });

    await vi.waitFor(() => expect(document.querySelector('.cook-skip')).not.toBeNull());
    click('.cook-skip');

    await vi.waitFor(() => expect(isModalOpen()).toBe(false));
    expect(calledWith('/api/meal-plans/e1', 'PATCH')).toBe(true);
    expect(lastBody('/api/meal-plans/e1', 'PATCH')).toEqual({ status: 'skipped' });
    expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(false);
    expect(document.querySelector('.cook-chip-row')).toBeNull();
    expect(document.querySelector('.toast')?.textContent).toMatch(/skipped/i);
    expect(onCooked).toHaveBeenCalledOnce();
    expect(onCooked.mock.calls[0]![0]).toMatchObject({
      entry: { id: 'e1', status: 'skipped' },
      deductions: [],
      shortfalls: [],
    });
  });

  test('a failed skip leaves the modal up and does not fire onCooked', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && u.pathname === '/api/meal-plans/e1') {
        return jsonResponse(500, { error: 'could not skip' });
      }
      return buildRouter()(input, init);
    });
    const onCooked = vi.fn();
    openCookFlow({ entry: ENTRY, onCooked });

    await vi.waitFor(() => expect(document.querySelector('.cook-skip')).not.toBeNull());
    click('.cook-skip');

    await vi.waitFor(() => expect(document.querySelector('.toast')?.textContent).toMatch(/could not skip|unexpected error/i));
    expect(isModalOpen()).toBe(true);
    expect(onCooked).not.toHaveBeenCalled();
    expect(calledWith('/api/meal-plans/e1/cook', 'POST')).toBe(false);
  });

  test('surfaces a 409 from cook as "already cooked" and refreshes the entry', async () => {
    fetchMock.mockImplementation(buildRouter({ cookStatus: 409 }));
    const onCooked = vi.fn();
    openCookFlow({ entry: ENTRY, onCooked });

    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    click('.cook-commit');

    await vi.waitFor(() => expect(isModalOpen()).toBe(false));
    expect(document.querySelector('.toast')?.textContent?.toLowerCase()).toContain('already cooked');
    expect(onCooked).toHaveBeenCalledOnce();
    expect(onCooked.mock.calls[0]![0]).toMatchObject({ entry: { status: 'cooked' } });
  });
});

describe('cook feedback', () => {
  const cooked: MealPlanEntry = { ...ENTRY, status: 'cooked' };

  /** worth-it / effort / make-again chips, leaving only "as written" unset. */
  function selectBaseChips(): void {
    click('.cook-chip[data-value="thumbs_up"]');
    click('.cook-chip[data-value="felt_right"]');
    click('.cook-chip[data-value="yes"]');
  }

  test('requires changesNote when "changed it" is chosen, blocked client-side', async () => {
    fetchMock.mockImplementation(buildRouter());
    openFeedbackModal(cooked);

    selectBaseChips();
    click('.cook-chip[data-value="changed"]');

    const saveBtn = document.querySelector<HTMLButtonElement>('.cook-feedback-save')!;
    expect(saveBtn.disabled).toBe(true);
    saveBtn.click();
    expect(calledWith('/feedback')).toBe(false);

    const noteInput = document.querySelector<HTMLTextAreaElement>('.cook-changes-note')!;
    noteInput.value = 'halved the cream, added dill at the end';
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(saveBtn.disabled).toBe(false);

    saveBtn.click();
    await vi.waitFor(() => expect(calledWith('/feedback')).toBe(true));
    const body = lastBody('/feedback');
    expect(body['usedAsIs']).toBe(false);
    expect(body['changesNote']).toBe('halved the cream, added dill at the end');
  });

  test('omits changesNote entirely when "as-is" is chosen', async () => {
    fetchMock.mockImplementation(buildRouter());
    openFeedbackModal(cooked);

    selectBaseChips();
    click('.cook-chip[data-value="as_is"]');

    const saveBtn = document.querySelector<HTMLButtonElement>('.cook-feedback-save')!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    await vi.waitFor(() => expect(calledWith('/feedback')).toBe(true));
    const body = lastBody('/feedback');
    expect(body['usedAsIs']).toBe(true);
    expect('changesNote' in body).toBe(false);
  });

  test('lets feedback be skipped without blocking', () => {
    fetchMock.mockImplementation(buildRouter());
    openFeedbackModal(cooked);

    expect(isModalOpen()).toBe(true);
    click('.cook-feedback-skip');
    expect(isModalOpen()).toBe(false);
    expect(calledWith('/feedback')).toBe(false);
  });
});
