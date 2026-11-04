// Meal plan week grid layout, multi-entry slots, and week navigation.
//
// The slot-order test is the one that catches trusting the API's own text
// ordering of `slot` (which reads breakfast/dinner/lunch/snack) instead of
// the client-side SLOTS order (breakfast/lunch/dinner/snack).

import './pin-sunday.js';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { planScreen } from '../screens/plan/index.js';
import { makeCtx, mountRoot, pathOf } from './harness.js';
import { makeEntry } from './fixtures.js';
import { buildRouter, MONDAY } from './plan-test-helpers.js';
import { addDays, isoToday } from '../format/date.js';
import type { MealPlanEntry } from '../api/types.js';

let fetchMock: ReturnType<typeof vi.fn>;

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

describe('several entries in one slot', () => {
  // cook-flow-design rejects a unique (date, slot) — several snacks a day are
  // normal — so a cell that kept only the last entry hid a meal that shopping
  // and cook still act on.
  const snacks = [
    makeEntry({ id: 'e-snack-1', date: MONDAY, slot: 'snack', status: 'planned', freeformNote: 'Rahka' }),
    makeEntry({ id: 'e-snack-2', date: MONDAY, slot: 'snack', status: 'skipped', freeformNote: 'Omena' }),
  ];

  async function mountPlan(entries: MealPlanEntry[]): Promise<HTMLElement> {
    fetchMock.mockImplementation(buildRouter({ entries }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());
    return root;
  }

  test('every entry gets its own cell, inside its slot and in API order', async () => {
    const root = await mountPlan(snacks);

    const monday = root.querySelector('.plan-day')!;
    const cells = [...monday.querySelectorAll(`.plan-cell[data-date="${MONDAY}"]`)];
    expect(cells.map((c) => c.getAttribute('data-slot'))).toEqual([
      'breakfast',
      'lunch',
      'dinner',
      'snack',
      'snack',
    ]);
    expect(
      [...monday.querySelectorAll('.plan-cell-title')].map((t) => t.textContent),
    ).toEqual(['Rahka', 'Omena']);
  });

  test('each cell opens its own entry', async () => {
    const root = await mountPlan(snacks);

    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="skipped"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.plan-edit-save')).not.toBeNull());
    closeModal();

    root.querySelector<HTMLButtonElement>('.plan-cell[data-status="planned"]')!.click();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => pathOf(String(u)) === '/api/meal-plans/e-snack-1/cook-preview'),
      ).toBe(true),
    );
  });

  test('the fill count counts occupied slots, not entries', async () => {
    const dinner = makeEntry({ id: 'e-dinner', date: MONDAY, slot: 'dinner', status: 'cooked', freeformNote: 'Keitto' });
    const root = await mountPlan([...snacks, dinner]);

    expect(root.querySelector('.plan-fill-stats')?.textContent).toBe('2 of 28 slots filled · 1 cooked');
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

    expect(isoToday()).toBe('2026-08-09');
    expect(MONDAY).toBe('2026-08-03');
    expect(weekGetMondays().at(-1)).toBe(MONDAY);
    expect(breakfastDates(root)).toEqual(isoWeek(MONDAY));
    expect(root.querySelector('.plan-cell-title')?.textContent).toBe(`note-${MONDAY}`);
    expect(root.querySelector('.plan-week-label')?.textContent).toContain('vk 32');

    const nextMonday = addDays(MONDAY, 7);
    root.querySelector<HTMLButtonElement>('[aria-label="next week"]')!.click();

    await vi.waitFor(() => expect(breakfastDates(root)[0]).toBe(nextMonday));
    expect(weekGetMondays().at(-1)).toBe(nextMonday);
    expect(breakfastDates(root)).toEqual(isoWeek(nextMonday));
    expect(root.querySelector('.plan-cell-title')?.textContent).toBe(`note-${nextMonday}`);
    expect(root.querySelector('.plan-week-label')?.textContent).toContain('vk 33');
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
    expect(root.querySelector('.plan-week-label')?.textContent).toContain('vk 31');
  });
});
