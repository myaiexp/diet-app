// Today screen overview: stat strip, "what now" rows, first-run state

import './pin-sunday.js';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { todayScreen } from '../screens/today/index.js';
import type { MealPlanEntry } from '../api/types.js';
import { makeCtx, mountRoot } from './harness.js';
import { makeEntry, makeIngredient, makePantryItem } from './fixtures.js';
import { buildRouter, MONDAY, TODAY } from './today-test-helpers.js';

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

describe('stat strip', () => {
  test('renders a muted placeholder, never a number, for tiles with no backing endpoint', async () => {
    fetchMock.mockImplementation(buildRouter({ pantry: [makePantryItem({ status: 'fresh' })] }));
    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const placeholders = [...root.querySelectorAll('.stat-placeholder')];
    expect(placeholders).toHaveLength(3); // eaten kcal, protein, to buy
    for (const p of placeholders) expect(p.textContent).toBe('—');

    const cellFor = (key: string) =>
      [...root.querySelectorAll('.stat-cell')].find((c) => c.querySelector('.stat-key')?.textContent === key);
    expect(cellFor('eaten')?.querySelector('.stat-value')?.classList.contains('stat-placeholder')).toBe(true);
    expect(cellFor('use today')?.querySelector('.stat-value')?.classList.contains('stat-placeholder')).toBe(false);
  });
});

describe('what now', () => {
  test('each row navigates to the screen that resolves it', async () => {
    const pantry = [makePantryItem({ id: 'p-expired', status: 'expired', ingredient: makeIngredient({ name: 'Dill' }) })];
    fetchMock.mockImplementation(buildRouter({ entries: [], pantry }));

    const root = mountRoot();
    const ctx = makeCtx();
    await todayScreen().mount(root, ctx);

    const rows = [...root.querySelectorAll<HTMLButtonElement>('.today-whatnow-row')];
    expect(rows.length).toBeGreaterThan(0);

    const expiredRow = rows.find((r) => r.textContent?.includes('expired'))!;
    expect(expiredRow).toBeTruthy();
    expiredRow.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/pantry');

    const openTodayRow = rows.find((r) => r.textContent?.includes('open today'))!;
    expect(openTodayRow).toBeTruthy();
    openTodayRow.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/plan');
  });

  test('renders fewer rows, not fabricated ones, when nothing needs attention', async () => {
    // A full week (28 slots) and a pantry with nothing urgent: no expired,
    // nothing due today, no empty slot, no empty day. Today's own dinner is
    // already cooked (not "planned"), so the new "cook tonight's X" row
    // — itself a legitimate, substantiated row — doesn't fire either: this
    // fixture is deliberately the case where truly nothing is left to do.
    const entries: MealPlanEntry[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(`${MONDAY}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + d);
      const iso = date.toISOString().slice(0, 10);
      for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
        const status = iso === TODAY && slot === 'dinner' ? 'cooked' : 'planned';
        entries.push(makeEntry({ id: `e-${iso}-${slot}`, date: iso, slot, status }));
      }
    }
    const pantry = [makePantryItem({ status: 'fresh' })];
    fetchMock.mockImplementation(buildRouter({ entries, pantry }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(root.querySelectorAll('.today-whatnow-row')).toHaveLength(0);
    expect(root.querySelector('.today-whatnow-empty')).not.toBeNull();
  });
});

describe('first run', () => {
  test('renders a coherent first-run state when the pantry and the week are both empty', async () => {
    fetchMock.mockImplementation(buildRouter({ entries: [], pantry: [] }));
    const root = mountRoot();
    const ctx = makeCtx();
    await todayScreen().mount(root, ctx);

    const panel = root.querySelector('.today-first-run');
    expect(panel).not.toBeNull();
    // Not four empty boxes: the normal stat strip / slots / spoiling layout
    // must not also render alongside the first-run panel.
    expect(root.querySelector('.today-stat-strip')).toBeNull();
    expect(root.querySelector('.today-slots')).toBeNull();

    const buttons = [...panel!.querySelectorAll('button')];
    expect(buttons.some((b) => b.textContent?.includes('pantry'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('import'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('plan'))).toBe(true);

    buttons.find((b) => b.textContent?.includes('pantry'))!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/pantry');
  });
});
