// Meal plan day column + slot cell rendering. The edit modal lives in
// modals/plan-edit.ts.
//
// A planned cell opens the shared cook flow (the plan screen wires that); a
// cooked cell never opens anything here — cooked is terminal, PATCH cannot
// set or leave it, and it cannot change recipeId/substituteRecipeId/servings,
// so there is nothing this file could let the user edit anyway.

import type { MealPlanEntry, Recipe, Slot } from '../../api/types.js';
import { SLOTS } from '../../api/types.js';
import { el, button } from '../../ui/dom.js';
import { finnishWeekday, finnishDate } from '../../format/date.js';
import { entryTitle, STATUS_LABEL } from '../../format/entry.js';
import { toNumber } from '../../format/quantity.js';

export interface CellHandlers {
  onEmpty(date: string, slot: Slot): void;
  onPlanned(entry: MealPlanEntry): void;
  onCooked(entry: MealPlanEntry): void;
  onReopen(entry: MealPlanEntry): void;
}

function buildFilledCell(
  date: string,
  slot: Slot,
  entry: MealPlanEntry,
  recipesById: Map<string, Recipe>,
  handlers: CellHandlers,
): HTMLElement {
  const cell = button(
    'plan-cell',
    '',
    () => {
      if (entry.status === 'cooked') handlers.onCooked(entry);
      else if (entry.status === 'planned') handlers.onPlanned(entry);
      else handlers.onReopen(entry);
    },
    { 'data-status': entry.status, 'data-date': date, 'data-slot': slot },
  );
  const status = STATUS_LABEL[entry.status];
  cell.append(
    el('span', { class: 'plan-cell-slot' }, slot),
    el('span', { class: 'plan-cell-title text-pretty' }, entryTitle(entry, recipesById)),
    el('span', { class: `plan-cell-status ${status.cls}` }, status.text),
    el('span', { class: 'plan-cell-serv' }, `${toNumber(entry.servings)} serv`),
  );
  return cell;
}

function buildEmptyCell(date: string, slot: Slot, handlers: CellHandlers): HTMLElement {
  const cell = button(
    'plan-cell plan-cell-empty',
    '',
    () => handlers.onEmpty(date, slot),
    { 'data-date': date, 'data-slot': slot },
  );
  cell.append(
    el('span', { class: 'plan-cell-slot' }, slot),
    el('span', { class: 'plan-cell-fill' }, '+ fill'),
  );
  return cell;
}

/** One day's header + its 4 slot cells, in SLOTS order (breakfast..snack). */
export function buildDayColumn(
  date: string,
  entriesBySlot: Map<Slot, MealPlanEntry>,
  recipesById: Map<string, Recipe>,
  handlers: CellHandlers,
  isToday: boolean,
): HTMLElement {
  const head = el(
    'div',
    { class: 'plan-day-head' },
    el('span', { class: `plan-day-weekday${isToday ? ' is-today' : ''}` }, finnishWeekday(date)),
    el('span', { class: 'plan-day-date' }, finnishDate(date)),
  );
  const column = el('div', { class: 'plan-day' }, head);
  for (const slot of SLOTS) {
    const entry = entriesBySlot.get(slot);
    column.appendChild(
      entry
        ? buildFilledCell(date, slot, entry, recipesById, handlers)
        : buildEmptyCell(date, slot, handlers),
    );
  }
  return column;
}
