// Shared add-entry affordance: fill a meal-plan slot with a recipe or a
// freeform note. Exported for reuse — the Today screen fills its own empty
// slots through this same `openAddEntry`, so its options shape is the public
// contract, not an implementation detail of the plan screen.
//
// mealPlanCreateSchema requires recipeId OR a non-empty freeformNote, never
// neither (CONTENT_MSG: "Either recipeId or freeformNote is required") — that
// is validated here before the request is ever sent, so the round trip to get
// that 400 back never happens on this path. Picking a recipe and typing a
// note are mutually exclusive in the UI for the same reason: there is no
// ambiguity for the API to resolve.

import type { MealPlanEntry, MealPlanCreate, Recipe, Slot } from '../api/types.js';
import { createEntry } from '../api/meal-plans.js';
import { listRecipes } from '../api/recipes.js';
import { el, button } from '../ui/dom.js';
import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';
import { userMessage, fieldErrors } from '../api/errors.js';
import { finnishWeekday, finnishDate } from '../format/date.js';

// The API's own max page size (see pagination.ts) — one request covers any
// collection this app will realistically have; a first-run install has zero.
const RECIPE_PAGE_LIMIT = 200;
const CONTENT_MSG = 'Pick a recipe, or type a note — one of the two is required.';

export interface AddEntryOptions {
  date: string;
  slot: Slot;
  onCreated: (entry: MealPlanEntry) => void;
}

/** All recipes for the picker, one page loop like recipes.ts's own fetch-all. */
export async function fetchRecipeCollection(): Promise<Recipe[]> {
  const all: Recipe[] = [];
  let offset = 0;
  for (;;) {
    const page = await listRecipes({ limit: RECIPE_PAGE_LIMIT, offset });
    all.push(...page);
    if (page.length < RECIPE_PAGE_LIMIT) return all;
    offset += RECIPE_PAGE_LIMIT;
  }
}

export interface RecipeOrNoteSelection {
  recipeId: string | null;
  freeformNote: string | null;
}

export interface RecipeOrNoteField {
  element: HTMLElement;
  setRecipes(recipes: Recipe[]): void;
  getSelection(): RecipeOrNoteSelection;
}

/**
 * Pick a recipe from the collection OR type a freeform note. Shared by the
 * add and edit forms (plan-cell.ts's `openEditEntry` reopens a skipped or
 * substituted entry with the same widget) so the "one of the two" rule only
 * has one UI implementation.
 */
export function createRecipeOrNoteField(
  initial: RecipeOrNoteSelection = { recipeId: null, freeformNote: null },
): RecipeOrNoteField {
  let recipes: Recipe[] = [];
  let pickedId: string | null = initial.recipeId;

  const searchInput = el('input', {
    class: 'input add-entry-search',
    type: 'text',
    placeholder: 'search recipes…',
  }) as HTMLInputElement;
  const listEl = el('div', { class: 'add-entry-recipe-list' });
  const noteInput = el('input', {
    class: 'input add-entry-note',
    type: 'text',
    placeholder: 'or a freeform note — Työlounas — canteen',
    value: initial.freeformNote ?? '',
  }) as HTMLInputElement;

  function pick(id: string | null): void {
    pickedId = id;
    if (id) noteInput.value = '';
    renderList(searchInput.value);
  }

  function renderList(filter: string): void {
    const needle = filter.trim().toLowerCase();
    const matches = needle ? recipes.filter((r) => r.title.toLowerCase().includes(needle)) : recipes;
    listEl.replaceChildren();
    if (matches.length === 0) {
      const empty = recipes.length === 0 ? 'No recipes yet — use a note instead.' : 'No matches.';
      listEl.appendChild(el('div', { class: 'add-entry-recipe-empty helper' }, empty));
      return;
    }
    for (const r of matches) {
      listEl.appendChild(
        button(
          `add-entry-recipe-row${r.id === pickedId ? ' is-selected' : ''}`,
          r.title,
          () => pick(r.id),
          { 'data-id': r.id },
        ),
      );
    }
  }

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  noteInput.addEventListener('input', () => {
    if (noteInput.value.trim()) pick(null);
  });

  const element = el(
    'div',
    { class: 'add-entry-picker' },
    el('span', { class: 'form-label' }, 'recipe'),
    searchInput,
    listEl,
    el('span', { class: 'form-label add-entry-or' }, 'or a freeform note'),
    noteInput,
  );

  return {
    element,
    setRecipes(next) {
      recipes = next;
      renderList(searchInput.value);
    },
    getSelection() {
      const note = noteInput.value.trim();
      return { recipeId: pickedId, freeformNote: pickedId ? null : note || null };
    },
  };
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
  const err = el('div', { class: 'helper-error hidden' });

  function showError(message: string, details: string[] = []): void {
    err.replaceChildren(message, ...details.map((d) => el('div', {}, d)));
    err.classList.remove('hidden');
  }

  const body = el(
    'div',
    { class: 'add-entry-form' },
    picker.element,
    el('div', { class: 'pantry-field' }, el('span', { class: 'form-label' }, 'servings'), servingsInput),
    err,
  );

  async function submit(): Promise<void> {
    const sel = picker.getSelection();
    if (!sel.recipeId && !sel.freeformNote) {
      showError(CONTENT_MSG);
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
      showError(userMessage(e), fieldErrors(e));
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

  void fetchRecipeCollection()
    .then((recipes) => picker.setRecipes(recipes))
    .catch((e: unknown) => showError(userMessage(e)));
}
