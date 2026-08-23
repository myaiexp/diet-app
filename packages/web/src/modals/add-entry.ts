// Add-to-plan modal: fill a meal-plan slot with a recipe or a freeform note.
// Today and the week grid both open this; its options shape is the public
// contract, not an implementation detail of either screen.
//
// The API's hasContent rule is recipeId, substituteRecipeId, or a non-empty
// freeformNote (same as PATCH). This modal only offers recipe XOR note — never
// substitute — and validates that pair here so the CONTENT_MSG 400 never
// happens on this path. Picking a recipe and typing a note are mutually
// exclusive in the UI for the same reason: there is no ambiguity for the API
// to resolve.

import type { MealPlanEntry, MealPlanCreate, Slot } from '../api/types.js';
import { createEntry } from '../api/meal-plans.js';
import { listAllRecipes } from '../api/recipes.js';
import { el, button } from '../ui/dom.js';
import { field, errorBox, showError } from '../ui/form.js';
import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';
import {
  createRecipeOrNoteField,
  RECIPE_OR_NOTE_REQUIRED,
} from '../ui/recipe-or-note.js';
import { userMessage, fieldErrors } from '../api/errors.js';
import { finnishWeekday, finnishDate } from '../format/date.js';

export interface AddEntryOptions {
  date: string;
  slot: Slot;
  onCreated: (entry: MealPlanEntry) => void;
}

/** Fill an empty slot: pick a recipe or type a note, then create the entry. */
export function openAddEntry(opts: AddEntryOptions): void {
  const { date, slot, onCreated } = opts;
  const picker = createRecipeOrNoteField();
  const servingsInput = el('input', {
    class: 'input',
    type: 'number',
    min: '1',
    max: '12',
    value: '1',
  }) as HTMLInputElement;
  const err = errorBox();

  const body = el(
    'div',
    { class: 'add-entry-form' },
    picker.element,
    field('servings', servingsInput),
    err,
  );

  async function submit(): Promise<void> {
    const sel = picker.getSelection();
    if (!sel.recipeId && !sel.freeformNote) {
      showError(err, RECIPE_OR_NOTE_REQUIRED);
      return;
    }
    const payload: MealPlanCreate = { date, slot };
    if (sel.recipeId) payload.recipeId = sel.recipeId;
    else payload.freeformNote = sel.freeformNote;
    const servings = Number(servingsInput.value);
    if (Number.isFinite(servings) && servings > 0) payload.servings = servings;

    try {
      const entry = await createEntry(payload);
      say('Added to plan.');
      closeModal();
      onCreated(entry);
    } catch (e) {
      showError(err, userMessage(e), fieldErrors(e));
    }
  }

  const footer = el(
    'div',
    { class: 'flex gap-2' },
    button('btn btn-ghost', 'cancel', () => closeModal()),
    button('btn btn-primary add-entry-save', 'add', () => void submit()),
  );

  openModal({
    title: 'Add to plan',
    meta: `${finnishWeekday(date)} ${finnishDate(date)} · ${slot}`,
    body,
    footer,
    width: 420,
  });

  void listAllRecipes()
    .then((recipes) => picker.setRecipes(recipes))
    .catch((e: unknown) => showError(err, userMessage(e)));
}
