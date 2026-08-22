// Meal plan day column + slot cell rendering, plus the edit modal used to
// reopen a skipped or substituted entry.
//
// A planned cell opens the shared cook flow (the plan screen wires that); a cooked
// cell never opens anything here — cooked is terminal, PATCH cannot set or
// leave it, and it cannot change recipeId/substituteRecipeId/servings, so
// there is nothing this file could let the user edit anyway.

import type { MealPlanEntry, MealPlanPatch, Recipe, Slot, EntryStatus } from '../../api/types.js';
import { SLOTS } from '../../api/types.js';
import { patchEntry } from '../../api/meal-plans.js';
import { el, button } from '../../ui/dom.js';
import { field, errorBox, showError } from '../../ui/form.js';
import { openModal, closeModal } from '../../ui/modal.js';
import { say } from '../../ui/toast.js';
import { userMessage, fieldErrors } from '../../api/errors.js';
import { finnishWeekday, finnishDate } from '../../format/date.js';
import { toNumber } from '../../format/quantity.js';
import { createRecipeOrNoteField, type RecipeOrNoteSelection } from './add-entry.js';

type EditableStatus = Exclude<EntryStatus, 'cooked'>;
const EDITABLE_STATUSES: readonly EditableStatus[] = ['planned', 'skipped', 'substituted'];

const STATUS_LABEL: Record<EntryStatus, { text: string; cls: string }> = {
  planned: { text: 'planned', cls: 'label' },
  cooked: { text: 'cooked', cls: 'label label-green' },
  skipped: { text: 'skipped', cls: 'label label-red' },
  substituted: { text: 'substituted', cls: 'label label-orange' },
};

export interface CellHandlers {
  onEmpty(date: string, slot: Slot): void;
  onPlanned(entry: MealPlanEntry): void;
  onCooked(entry: MealPlanEntry): void;
  onReopen(entry: MealPlanEntry): void;
}

/** Recipe title (+ notes) for a recipe-backed entry, else the freeform note. */
function entryTitle(entry: MealPlanEntry, recipesById: Map<string, Recipe>): string {
  const recipeId = entry.substituteRecipeId ?? entry.recipeId;
  if (recipeId) {
    const title = recipesById.get(recipeId)?.title ?? '(recipe)';
    return entry.notes ? `${title} · ${entry.notes}` : title;
  }
  return entry.freeformNote ?? '(untitled)';
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

/**
 * Map the picker onto the column cook/title/shopping resolve
 * (`substituteRecipeId ?? recipeId`). The picker is seeded from that pair, so
 * a leftover substitute must be written or cleared — omitting it makes the
 * edit a no-op. Leave `recipeId` off a substituted save so we don't clobber
 * the original with the substitute's id.
 */
function recipeFieldsForPatch(
  status: EditableStatus,
  sel: RecipeOrNoteSelection,
): Pick<MealPlanPatch, 'recipeId' | 'freeformNote' | 'substituteRecipeId'> {
  if (!sel.recipeId) {
    return { recipeId: null, substituteRecipeId: null, freeformNote: sel.freeformNote };
  }
  if (status === 'substituted') {
    return { substituteRecipeId: sel.recipeId, freeformNote: null };
  }
  return { recipeId: sel.recipeId, substituteRecipeId: null, freeformNote: null };
}

/**
 * Reopen a skipped or substituted entry: date/slot/notes/status/servings and
 * the recipe-or-note pick are all still editable (only a *cooked* entry locks
 * recipeId/substituteRecipeId/servings). Reuses the same recipe-or-note
 * widget as the add form so the "one of the two" rule has one implementation.
 * The pick is written through `recipeFieldsForPatch` so substituteRecipeId
 * cannot outlive a planned/skipped/freeform save.
 */
export function openEditEntry(
  entry: MealPlanEntry,
  recipes: Recipe[],
  onSaved: (updated: MealPlanEntry) => void,
): void {
  const dateInput = el('input', { class: 'input', type: 'date', value: entry.date.slice(0, 10) }) as HTMLInputElement;
  const slotSelect = el('select', { class: 'select' }) as HTMLSelectElement;
  for (const s of SLOTS) slotSelect.appendChild(el('option', { value: s, selected: s === entry.slot }, s));

  const statusSelect = el('select', { class: 'select plan-edit-status' }) as HTMLSelectElement;
  for (const s of EDITABLE_STATUSES) {
    statusSelect.appendChild(el('option', { value: s, selected: s === entry.status }, s));
  }

  const servingsInput = el('input', {
    class: 'input',
    type: 'number',
    min: '1',
    max: '12',
    value: entry.servings,
  }) as HTMLInputElement;
  const notesInput = el('input', { class: 'input', type: 'text', value: entry.notes ?? '' }) as HTMLInputElement;

  const picker = createRecipeOrNoteField({
    recipeId: entry.substituteRecipeId ?? entry.recipeId,
    freeformNote: entry.freeformNote,
  });
  picker.setRecipes(recipes);

  const err = errorBox();

  const body = el(
    'div',
    { class: 'plan-edit-form' },
    field('date', dateInput),
    field('slot', slotSelect),
    picker.element,
    field('servings', servingsInput),
    field('notes', notesInput),
    field('status', statusSelect),
    err,
  );

  async function submit(): Promise<void> {
    const sel = picker.getSelection();
    if (!sel.recipeId && !sel.freeformNote) {
      showError(err, 'Pick a recipe, or type a note — one of the two is required.');
      return;
    }
    const status = statusSelect.value as EditableStatus;
    const patch: MealPlanPatch = {
      date: dateInput.value,
      slot: slotSelect.value as Slot,
      status,
      notes: notesInput.value.trim() ? notesInput.value.trim() : null,
      ...recipeFieldsForPatch(status, sel),
    };
    const servings = Number(servingsInput.value);
    if (Number.isFinite(servings) && servings > 0) patch.servings = servings;

    try {
      const updated = await patchEntry(entry.id, patch);
      say('Entry updated.');
      closeModal();
      onSaved(updated);
    } catch (e) {
      showError(err, userMessage(e), fieldErrors(e));
    }
  }

  const footer = el(
    'div',
    { class: 'flex gap-2' },
    button('btn btn-ghost', 'cancel', () => closeModal()),
    button('btn btn-primary plan-edit-save', 'save', () => void submit()),
  );

  openModal({
    title: 'Edit entry',
    meta: `${finnishWeekday(entry.date)} ${finnishDate(entry.date)} · ${entry.slot}`,
    body,
    footer,
    width: 420,
  });
}
