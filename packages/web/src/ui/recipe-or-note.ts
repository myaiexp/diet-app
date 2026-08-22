// Recipe-or-note picker: pick from the collection XOR type a freeform note

import type { Recipe } from '../api/types.js';
import { el, button } from './dom.js';

export const RECIPE_OR_NOTE_REQUIRED =
  'Pick a recipe, or type a note — one of the two is required.';

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
 * Shared by the add-entry and edit-entry modals so the "one of the two"
 * rule only has one UI implementation. Picking a recipe clears the note
 * and vice versa — mealPlanCreateSchema rejects neither-and-both the same way.
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
