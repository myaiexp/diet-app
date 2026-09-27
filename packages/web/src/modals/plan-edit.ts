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
import { el } from '../ui/dom.js';
import { field, errorBox, showError, selectInput } from '../ui/form.js';
import { openModal } from '../ui/modal.js';
import { modalFooter, submitModal } from '../ui/modal-form.js';
import { finnishWeekday, finnishDate } from '../format/date.js';
import { CREATE_STATUSES, MIN_SERVINGS, MAX_SERVINGS } from '@diet-app/api/vocab';
import {
  createRecipeOrNoteField,
  RECIPE_OR_NOTE_REQUIRED,
  type RecipeOrNoteSelection,
} from '../ui/recipe-or-note.js';

type EditableStatus = Exclude<EntryStatus, 'cooked'>;
// The same non-cooked set create accepts — cooked is owned by POST /:id/cook.
const EDITABLE_STATUSES: readonly EditableStatus[] = CREATE_STATUSES;

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
  const slotSelect = selectInput(SLOTS, entry.slot);
  const statusSelect = selectInput<EntryStatus>(EDITABLE_STATUSES, entry.status, { class: 'plan-edit-status' });

  const servingsInput = el('input', {
    class: 'input',
    type: 'number',
    min: String(MIN_SERVINGS),
    max: String(MAX_SERVINGS),
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

    await submitModal(() => patchEntry(entry.id, patch), {
      errorBox: err,
      success: 'Entry updated.',
      onDone: onSaved,
    });
  }

  const footer = modalFooter({ label: 'save', class: 'plan-edit-save', onClick: () => void submit() });

  openModal({
    title: 'Edit entry',
    meta: `${finnishWeekday(entry.date)} ${finnishDate(entry.date)} · ${entry.slot}`,
    body,
    footer,
    width: 420,
  });
}
