// Meal plan week grid, week navigation, and the shared add-entry affordance.
//
// The slot-order test is the one that catches trusting the API's own text
// ordering of `slot` (which reads breakfast/dinner/lunch/snack) instead of
// the client-side SLOTS order (breakfast/lunch/dinner/snack).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { planScreen } from '../screens/plan/index.js';
import { mondayOf, isoToday, addDays, isoWeekNumber } from '../format/date.js';
import type { MealPlanEntry, Recipe } from '../api/types.js';
import { jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeEntry, makeRecipe } from './fixtures.js';

const MONDAY = mondayOf(isoToday());

interface RouterOpts {
  entries?: MealPlanEntry[];
  recipes?: Recipe[];
  /** When set, the week GET is keyed on `:monday` instead of a static array. */
  weekByMonday?: (monday: string) => MealPlanEntry[];
}

/** Routes: week GET, recipes GET, entry POST, cook-preview GET, cook POST, entry PATCH, pantry GET. */
function buildRouter(opts: RouterOpts = {}) {
  const entries = opts.entries ?? [];
  const recipes = opts.recipes ?? [];
  let createdCount = 0;

  return routeFetch({
    'GET /api/meal-plans/week/:monday': ({ params }) => {
      const monday = params['monday']!;
      return opts.weekByMonday ? opts.weekByMonday(monday) : entries;
    },
    'GET /api/recipes': recipes,
    'POST /api/meal-plans': ({ json }) => {
      const body = json<Record<string, unknown>>();
      const entry = makeEntry({
        id: `new-${createdCount++}`,
        date: String(body['date'] ?? MONDAY),
        slot: (body['slot'] as MealPlanEntry['slot']) ?? 'breakfast',
        recipeId: (body['recipeId'] as string | undefined) ?? null,
        freeformNote: (body['freeformNote'] as string | undefined) ?? null,
        servings: String(body['servings'] ?? 1),
        status: 'planned',
      });
      return jsonResponse(201, entry);
    },
    'GET /api/meal-plans/:id/cook-preview': { deductions: [], shortfalls: [], servings: 4 },
    'POST /api/meal-plans/:id/cook': ({ params }) => {
      const id = params['id']!;
      const base = entries.find((e) => e.id === id) ?? makeEntry({ id });
      return { entry: { ...base, status: 'cooked' as const }, deductions: [], shortfalls: [] };
    },
    'PATCH /api/meal-plans/:id': ({ params, json }) => {
      const id = params['id'];
      const body = json<Record<string, unknown>>();
      const base = entries.find((e) => e.id === id) ?? makeEntry({ id });
      return { ...base, ...body, servings: String(body['servings'] ?? base.servings) };
    },
    'GET /api/pantry': [],
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function postCalls() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      pathOf(String(url)) === '/api/meal-plans' && ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST',
  );
}

function weekGetMondays(): string[] {
  return fetchMock.mock.calls
    .map(([url]) => {
      const match = pathOf(String(url)).match(/^\/api\/meal-plans\/week\/(\d{4}-\d{2}-\d{2})$/);
      return match?.[1] ?? null;
    })
    .filter((d): d is string => d !== null);
}

function breakfastDates(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.plan-cell[data-slot="breakfast"]')].map(
    (c) => c.getAttribute('data-date') ?? '',
  );
}

function isoWeek(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

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

describe('plan screen layout', () => {
  test('lays out 7 days x 4 slots ma..su, slots in breakfast/lunch/dinner/snack order', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    const days = [...root.querySelectorAll('.plan-day')];
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.querySelector('.plan-day-weekday')?.textContent)).toEqual([
      'ma',
      'ti',
      'ke',
      'to',
      'pe',
      'la',
      'su',
    ]);

    for (const day of days) {
      const slots = [...day.querySelectorAll('.plan-cell-slot')].map((s) => s.textContent);
      // Not alphabetical (breakfast/dinner/lunch/snack) — the client's own
      // SLOTS order, never the API's un-sorted text order.
      expect(slots).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    }
  });

  test('sets the subtitle from real week data', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    const ctx = makeCtx();
    await planScreen().mount(root, ctx);

    expect(ctx.setSubtitle).toHaveBeenCalled();
    const text = ctx.setSubtitle.mock.calls.at(-1)?.[0] as string;
    expect(text).toMatch(/^vk \d+ · /);
  });

  test('keeps the grid horizontally scrollable below 1050px rather than reflowing', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    const wrap = root.querySelector('.plan-grid-wrap');
    const grid = root.querySelector<HTMLElement>('.plan-grid');
    expect(wrap).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(wrap?.contains(grid)).toBe(true);
    // Asserted directly on the element, not through a media query: the
    // design requires min-width inside overflow-x:auto unconditionally.
    expect(grid?.style.minWidth).toBe('1050px');
  });
});

describe('plan week navigation', () => {
  function weekRouter() {
    return buildRouter({
      weekByMonday: (monday) => [
        makeEntry({
          id: `e-${monday}`,
          date: monday,
          slot: 'breakfast',
          freeformNote: `note-${monday}`,
        }),
      ],
    });
  }

  test("next week requests monday+7 and paints that week's day headers", async () => {
    fetchMock.mockImplementation(weekRouter());
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    expect(weekGetMondays().at(-1)).toBe(MONDAY);
    expect(breakfastDates(root)).toEqual(isoWeek(MONDAY));
    expect(root.querySelector('.plan-cell-title')?.textContent).toBe(`note-${MONDAY}`);
    expect(root.querySelector('.plan-week-label')?.textContent).toContain(`vk ${isoWeekNumber(MONDAY)}`);

    const nextMonday = addDays(MONDAY, 7);
    root.querySelector<HTMLButtonElement>('[aria-label="next week"]')!.click();

    await vi.waitFor(() => expect(breakfastDates(root)[0]).toBe(nextMonday));
    expect(weekGetMondays().at(-1)).toBe(nextMonday);
    expect(breakfastDates(root)).toEqual(isoWeek(nextMonday));
    expect(root.querySelector('.plan-cell-title')?.textContent).toBe(`note-${nextMonday}`);
    expect(root.querySelector('.plan-week-label')?.textContent).toContain(`vk ${isoWeekNumber(nextMonday)}`);
    // A ±1-day bug stays inside the same ISO week; the requested monday must
    // actually move by a full week.
    expect(nextMonday).not.toBe(addDays(MONDAY, 1));
  });

  test("previous week requests monday-7 and paints that week's day headers", async () => {
    fetchMock.mockImplementation(weekRouter());
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    const prevMonday = addDays(MONDAY, -7);
    root.querySelector<HTMLButtonElement>('[aria-label="previous week"]')!.click();

    await vi.waitFor(() => expect(breakfastDates(root)[0]).toBe(prevMonday));
    expect(weekGetMondays().at(-1)).toBe(prevMonday);
    expect(breakfastDates(root)).toEqual(isoWeek(prevMonday));
    expect(root.querySelector('.plan-cell-title')?.textContent).toBe(`note-${prevMonday}`);
    expect(root.querySelector('.plan-week-label')?.textContent).toContain(`vk ${isoWeekNumber(prevMonday)}`);
  });
});

describe('add-entry affordance', () => {
  test('an empty cell opens the add-entry affordance and does not navigate', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    const ctx = makeCtx();
    await planScreen().mount(root, ctx);

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();

    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.add-entry-picker')).not.toBeNull();
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  test('creates a recipe-backed entry from the picker', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [makeRecipe({ id: 'r1', title: 'Lohikeitto' })] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-recipe-row')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('.add-entry-recipe-row[data-id="r1"]')!.click();
    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, init] = postCalls()[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body['recipeId']).toBe('r1');
    expect('freeformNote' in body).toBe(false);
    expect(body['slot']).toBe('breakfast');
    expect(body['date']).toBe(MONDAY);
  });

  test('creates a freeform-note entry with no recipe', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-picker')).not.toBeNull());

    const noteInput = document.querySelector<HTMLInputElement>('.add-entry-note')!;
    noteInput.value = 'Työlounas — canteen';
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, init] = postCalls()[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body['freeformNote']).toBe('Työlounas — canteen');
    expect('recipeId' in body).toBe(false);
  });

  test('rejects an add with neither a recipe nor a note before sending', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-picker')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    expect(postCalls()).toHaveLength(0);
    const err = document.querySelector('.helper-error');
    expect(err?.classList.contains('hidden')).toBe(false);
    expect(err?.textContent).toMatch(/recipe|note/i);
  });

  test('works with an empty recipe collection (freeform-only first run)', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('.add-entry-recipe-empty')?.textContent).toMatch(/no recipes yet/i),
    );
  });
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
    // grid is the only surface left — the cell already flipped via onCooked.
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
