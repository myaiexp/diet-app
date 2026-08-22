// Today screen: the landing view — a queue of actions, not a dashboard.
//
// Three bounded data requests back every stat tile and every row: getWeek for
// this ISO week, listAllPantry() for the whole pantry, and listAllRecipes()
// once (the same helper the plan screen uses) so recipe-backed entries render
// their real title instead of a generic placeholder. None of the three scales
// with row/tile count — that's the rule this screen actually protects, not
// "two requests" as a magic number. A collection past the API page ceiling of
// 200 costs extra pages, not extra rows. Per-entry feedback lookups for today's
// cooked slots are the only requests beyond those three, bounded by how many
// entries are cooked today — and a 404 from getFeedback is the normal "not
// yet rated" case, not an error (see loadRatedMap).
//
// Panel rendering lives in panels.ts / whatnow.ts.

import '../../css/today.css';
import type { Screen, ScreenContext } from '../../router.js';
import type { MealPlanEntry, PantryItem, Recipe } from '../../api/types.js';
import { getWeek, getFeedback } from '../../api/meal-plans.js';
import { listAllPantry } from '../../api/pantry.js';
import { listAllRecipes } from '../../api/recipes.js';
import { userMessage } from '../../api/errors.js';
import { el, errorPanel, loadingRow } from '../../ui/dom.js';
import { openAddEntry } from '../../modals/add-entry.js';
import { openCookFlow, openFeedbackModal } from '../../modals/cook-flow.js';
import { mondayOf, isoToday, finnishWeekdayLong, finnishDate } from '../../format/date.js';
import { buildStatStrip, buildSlotsPanel, buildSpoilingPanel, type SlotHandlers } from './panels.js';
import { buildWhatNowPanel, buildFirstRun } from './whatnow.js';

/** Which of today's cooked entries already have feedback — a 404 means no. */
async function loadRatedMap(cookedToday: MealPlanEntry[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  await Promise.all(
    cookedToday.map(async (entry) => {
      try {
        await getFeedback(entry.id);
        map.set(entry.id, true);
      } catch {
        // A 404 here is the ordinary "not rated yet" case — every other
        // failure also leaves the row as unrated rather than blocking the
        // page, since this is a best-effort enrichment, not core data.
        map.set(entry.id, false);
      }
    }),
  );
  return map;
}

export function todayScreen(): Screen {
  let destroyed = false;
  let ctx: ScreenContext;
  let rootEl: HTMLElement;
  let monday = mondayOf(isoToday());
  let entries: MealPlanEntry[] = [];
  let pantryItems: PantryItem[] = [];
  let recipesById = new Map<string, Recipe>();
  let ratedByEntryId = new Map<string, boolean>();

  function updateSubtitle(): void {
    const todayIso = isoToday();
    const todays = entries.filter((e) => e.date === todayIso);
    const planned = todays.filter((e) => e.status === 'planned').length;
    const cooked = todays.filter((e) => e.status === 'cooked').length;
    ctx.setSubtitle(
      `${finnishWeekdayLong(todayIso)} ${finnishDate(todayIso)} · ${planned} planned, ${cooked} cooked`,
    );
  }

  function render(): void {
    if (entries.length === 0 && pantryItems.length === 0) {
      rootEl.replaceChildren(buildFirstRun(ctx.navigate));
      return;
    }

    const todayIso = isoToday();
    const todaysEntries = entries.filter((e) => e.date === todayIso);
    const handlers: SlotHandlers = {
      onEmpty: (date, slot) => openAddEntry({ date, slot, onCreated: addCreatedEntry }),
      onCook: (entry) => openCookFlow({ entry, onCooked: (result) => refreshEntry(result.entry) }),
      onRate: (entry) => openFeedbackModal(entry),
    };

    const stack = el(
      'div',
      { class: 'today-stack' },
      buildStatStrip(pantryItems),
      el(
        'div',
        { class: 'today-columns' },
        buildSlotsPanel(todayIso, todaysEntries, ratedByEntryId, recipesById, handlers),
        buildSpoilingPanel(pantryItems, ctx.navigate),
      ),
      buildWhatNowPanel(entries, pantryItems, monday, recipesById, ctx.navigate),
    );
    rootEl.replaceChildren(stack);
  }

  function refreshEntry(updated: MealPlanEntry): void {
    entries = entries.map((e) => (e.id === updated.id ? updated : e));
    updateSubtitle();
    render();
  }

  function addCreatedEntry(created: MealPlanEntry): void {
    entries = [...entries, created];
    updateSubtitle();
    render();
  }

  async function loadAll(): Promise<void> {
    rootEl.replaceChildren(loadingRow('loading today…'));
    try {
      monday = mondayOf(isoToday());
      const [weekEntries, pantry, recipes] = await Promise.all([
        getWeek(monday),
        listAllPantry(),
        listAllRecipes(),
      ]);
      if (destroyed) return;
      entries = weekEntries;
      pantryItems = pantry;
      recipesById = new Map(recipes.map((r) => [r.id, r]));

      const todayIso = isoToday();
      const cookedToday = entries.filter((e) => e.date === todayIso && e.status === 'cooked');
      ratedByEntryId = await loadRatedMap(cookedToday);
      if (destroyed) return;

      updateSubtitle();
      render();
    } catch (err) {
      if (destroyed) return;
      rootEl.replaceChildren(errorPanel(userMessage(err), () => void loadAll()));
    }
  }

  return {
    title: 'Today',
    async mount(root, screenCtx) {
      ctx = screenCtx;
      destroyed = false;
      rootEl = root;
      entries = [];
      pantryItems = [];
      recipesById = new Map();
      ratedByEntryId = new Map();
      await loadAll();
    },
    unmount() {
      destroyed = true;
    },
  };
}
