// Meal plan week screen: 7x4 grid, week navigation, and the cook / add-entry
// wiring. Slot order and title/status rendering live in cell.ts, and the
// create affordance in add-entry.ts — reused by the Today screen.
//
// `slot` is text and the API deliberately never sorts it (sorted as text it
// reads breakfast/dinner/lunch/snack) — SLOTS gives the order the client lays
// out. Days run ma..su from `mondayOf`/`addDays`, never the order entries
// happen to arrive in.

import '../../css/plan.css';
import type { Screen, ScreenContext } from '../../router.js';
import type { MealPlanEntry, Recipe, Slot } from '../../api/types.js';
import { SLOTS } from '../../api/types.js';
import { getWeek } from '../../api/meal-plans.js';
import { listAllRecipes } from '../../api/recipes.js';
import { userMessage } from '../../api/errors.js';
import { el, button, errorPanel, loadingRow } from '../../ui/dom.js';
import { say } from '../../ui/toast.js';
import { openCookFlow } from '../../modals/cook-flow.js';
import { mondayOf, addDays, isoToday, isoWeekNumber } from '../../format/date.js';
import { openAddEntry } from './add-entry.js';
import { buildDayColumn, openEditEntry, type CellHandlers } from './cell.js';

const DAY_COUNT = 7;
const TOTAL_SLOTS = DAY_COUNT * SLOTS.length;
const COOKED_LOCK_MESSAGE = 'Cooked entries are locked — the deduction was computed from them.';

function shortDayMonth(iso: string): { day: number; month: number } {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1 };
}

/** '3.–9.8.' within a month, '28.7.–3.8.' across a month boundary. */
function weekRangeLabel(monday: string): string {
  const start = shortDayMonth(monday);
  const end = shortDayMonth(addDays(monday, 6));
  const startText = start.month === end.month ? `${start.day}.` : `${start.day}.${start.month}.`;
  return `${startText}–${end.day}.${end.month}.`;
}

export function planScreen(): Screen {
  let destroyed = false;
  let ctx: ScreenContext;
  let monday = mondayOf(isoToday());
  let entries: MealPlanEntry[] = [];
  let recipesById = new Map<string, Recipe>();

  let bodyEl: HTMLElement;
  let weekLabelEl: HTMLElement;
  let statsEl: HTMLElement;

  function updateSubtitle(): void {
    ctx.setSubtitle(`vk ${isoWeekNumber(monday)} · ${weekRangeLabel(monday)}`);
  }

  function updateToolbar(): void {
    weekLabelEl.textContent = `vk ${isoWeekNumber(monday)} · ${weekRangeLabel(monday)}`;
    const cooked = entries.filter((e) => e.status === 'cooked').length;
    statsEl.textContent = `${entries.length} of ${TOTAL_SLOTS} slots filled · ${cooked} cooked`;
  }

  function refreshEntry(updated: MealPlanEntry): void {
    entries = entries.map((e) => (e.id === updated.id ? updated : e));
    renderGrid();
    updateToolbar();
  }

  function addCreatedEntry(created: MealPlanEntry): void {
    entries = [...entries, created];
    renderGrid();
    updateToolbar();
  }

  const handlers: CellHandlers = {
    onEmpty: (date, slot) => openAddEntry({ date, slot, onCreated: addCreatedEntry }),
    onPlanned: (entry) => openCookFlow({ entry, onCooked: (result) => refreshEntry(result.entry) }),
    onCooked: () => say(COOKED_LOCK_MESSAGE, 'error'),
    onReopen: (entry) => openEditEntry(entry, [...recipesById.values()], refreshEntry),
  };

  function renderGrid(): void {
    const today = isoToday();
    // min-width is set inline (not only in plan.css) so the grid can never be
    // narrowed by a flex/grid ancestor squeezing it — the wrapper below is
    // the one and only place that scrolls horizontally.
    const grid = el('div', { class: 'plan-grid hairline-grid', style: 'min-width: 1050px' });
    for (let i = 0; i < DAY_COUNT; i++) {
      const date = addDays(monday, i);
      const bySlot = new Map<Slot, MealPlanEntry>();
      for (const e of entries) if (e.date === date) bySlot.set(e.slot, e);
      grid.appendChild(buildDayColumn(date, bySlot, recipesById, handlers, date === today));
    }
    const wrap = el('div', { class: 'plan-grid-wrap' }, grid);
    const legend = el(
      'div',
      { class: 'plan-legend helper' },
      'planned → click to cook · cooked → locked, deduction applied · substituted · skipped',
    );
    bodyEl.replaceChildren(wrap, legend);
  }

  async function loadWeek(): Promise<void> {
    bodyEl.replaceChildren(loadingRow('loading week…'));
    try {
      const [weekEntries, recipes] = await Promise.all([getWeek(monday), listAllRecipes()]);
      if (destroyed) return;
      entries = weekEntries;
      recipesById = new Map(recipes.map((r) => [r.id, r]));
      updateSubtitle();
      updateToolbar();
      renderGrid();
    } catch (err) {
      if (destroyed) return;
      bodyEl.replaceChildren(errorPanel(userMessage(err), () => void loadWeek()));
    }
  }

  function changeWeek(deltaDays: number): void {
    monday = addDays(monday, deltaDays);
    void loadWeek();
  }

  return {
    title: 'Meal plan',
    async mount(root, screenCtx) {
      ctx = screenCtx;
      destroyed = false;
      monday = mondayOf(isoToday());
      entries = [];

      const prevBtn = button('btn btn-sm', '←', () => changeWeek(-7), { 'aria-label': 'previous week' });
      const nextBtn = button('btn btn-sm', '→', () => changeWeek(7), { 'aria-label': 'next week' });
      weekLabelEl = el('span', { class: 'plan-week-label' }, '');
      statsEl = el('span', { class: 'helper plan-fill-stats' }, '');
      const suggestBtn = button('btn btn-primary btn-sm', 'fill with AI', () => ctx.navigate('/suggest'));
      const shoppingBtn = button('btn btn-ghost btn-sm', 'shopping list →', () => ctx.navigate('/shopping'));

      const toolbar = el(
        'div',
        { class: 'bar plan-toolbar' },
        prevBtn,
        weekLabelEl,
        nextBtn,
        statsEl,
        el('div', { class: 'plan-toolbar-actions' }, suggestBtn, shoppingBtn),
      );

      bodyEl = el('div', { class: 'plan-body' });
      root.append(toolbar, bodyEl);

      await loadWeek();
    },
    unmount() {
      destroyed = true;
    },
  };
}
