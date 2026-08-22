// Edit-entry modal: reopen a skipped or substituted (or still-planned) entry.
//
// Date/slot/notes/status/servings and the recipe-or-note pick are all still
// editable — only a cooked entry locks recipeId/substituteRecipeId/servings,
// and cooked cells never open this. The pick is written through
// recipeFieldsForPatch so substituteRecipeId cannot outlive a
// planned/skipped/freeform save.

import type { MealPlanEntry, MealPlanPatch, Recipe, Slot, EntryStatus } from '../api/types.js';
import { SLOTS } from '../api/types.js';
import { patchEntry } from '../api/meal-plans.js';
import { el, button } from '../ui/dom.js';
import { field, errorBox, showError } from '../ui/form.js';
import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';
import { userMessage, fieldErrors } from '../api/errors.js';
import { finnishWeekday, finnishDate } from '../format/date.js';
import {
  createRecipeOrNoteField,
  RECIPE_OR_NOTE_REQUIRED,
  type RecipeOrNoteSelection,
} from '../ui/recipe-or-note.js';

type EditableStatus = Exclude<EntryStatus, 'cooked'>;
const EDITABLE_STATUSES: readonly EditableStatus[] = ['planned', 'skipped', 'substituted'];

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
      showError(err, RECIPE_OR_NOTE_REQUIRED);
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
