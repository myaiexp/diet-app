// Debounced catalog search + pick-then-quantity form (pantry, shopping, profile, import)

import type { Ingredient } from '../api/types.js';
import { searchIngredients } from '../api/ingredients.js';
import { userMessage } from '../api/errors.js';
import { el, button } from './dom.js';
import { field, errorBox, showError, hideError } from './form.js';
import { say } from './toast.js';

export const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 8;

export const INGREDIENT_SEARCH_PLACEHOLDER = 'search ingredients — peruna, potato…';
const MSG_PICK_INGREDIENT = 'Pick an ingredient first.';
const MSG_QTY_POSITIVE = 'Quantity must be a positive number.';
const MSG_UNIT_REQUIRED = 'Unit is required.';

export interface IngredientSearchOptions {
  /** Drop matches the caller already holds (e.g. disliked-ingredient chips). */
  filter?: (ing: Ingredient) => boolean;
  renderResult?: (ing: Ingredient, pick: () => void) => HTMLElement;
  emptyText?: string;
  debounceMs?: number;
  limit?: number;
  /** Search `input.value` as soon as the helper attaches. */
  immediate?: boolean;
  searchingText?: string;
}

/** Debounced catalog search wired to an input + a results list under it. */
export function attachIngredientSearch(
  input: HTMLInputElement,
  results: HTMLElement,
  onPick: (ing: Ingredient) => void,
  opts: IngredientSearchOptions = {},
): void {
  const debounceMs = opts.debounceMs ?? SEARCH_DEBOUNCE_MS;
  const limit = opts.limit ?? SEARCH_LIMIT;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  function emptyNode(text: string | undefined): HTMLElement {
    // `.helper` is in base.css so import gets the muted empty copy even when
    // the dropdown chrome is a wrap of small buttons, not pantry-search-*.
    return el('p', { class: 'helper pantry-search-empty' }, text ?? 'no matches');
  }

  function defaultRow(ing: Ingredient): HTMLElement {
    const row = button('pantry-search-result', '', () => onPick(ing));
    const alias = ing.aliases?.[0];
    row.append(el('span', {}, ing.name), alias ? el('span', { class: 'pantry-alias' }, alias) : '');
    return row;
  }

  async function runSearch(q: string): Promise<void> {
    const my = ++seq;
    const needle = q.trim();
    if (!needle) {
      results.replaceChildren();
      return;
    }
    if (opts.searchingText) {
      results.replaceChildren(el('p', { class: 'helper' }, opts.searchingText));
    }
    let matches: Ingredient[];
    try {
      matches = await searchIngredients(needle, limit);
    } catch (e) {
      if (my !== seq) return;
      say(userMessage(e), 'error');
      if (opts.searchingText) results.replaceChildren(emptyNode(opts.emptyText));
      return;
    }
    if (my !== seq) return;
    if (opts.filter) matches = matches.filter(opts.filter);
    results.replaceChildren();
    if (matches.length === 0) {
      results.appendChild(emptyNode(opts.emptyText));
      return;
    }
    for (const ing of matches) {
      const pick = (): void => onPick(ing);
      results.appendChild(opts.renderResult ? opts.renderResult(ing, pick) : defaultRow(ing));
    }
  }

  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    const q = input.value;
    timer = setTimeout(() => void runSearch(q), debounceMs);
  });

  if (opts.immediate) void runSearch(input.value);
}

export function readQuantityUnit(
  qtyInput: HTMLInputElement,
  unitInput: HTMLInputElement,
  err: HTMLElement,
): { quantity: number; unit: string } | null {
  const quantity = Number(qtyInput.value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    showError(err, MSG_QTY_POSITIVE);
    return null;
  }
  const unit = unitInput.value.trim();
  if (!unit) {
    showError(err, MSG_UNIT_REQUIRED);
    return null;
  }
  return { quantity, unit };
}

export interface IngredientQuantityForm {
  body: HTMLElement;
  pickStep: HTMLElement;
  detailStep: HTMLElement;
  qtyInput: HTMLInputElement;
  unitInput: HTMLInputElement;
  err: HTMLElement;
  selectIngredient(ing: Ingredient): void;
  read(): { ingredient: Ingredient; quantity: number; unit: string } | null;
}

export function createIngredientQuantityForm(opts: {
  extraFields?: HTMLElement[];
} = {}): IngredientQuantityForm {
  let chosen: Ingredient | null = null;

  const searchInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: INGREDIENT_SEARCH_PLACEHOLDER,
  }) as HTMLInputElement;
  const searchResults = el('div', { class: 'pantry-search-results' });
  const pickStep = el('div', { class: 'pantry-field' }, field('ingredient', searchInput), searchResults);

  const chosenLabel = el('div', { class: 'pantry-chosen' }, '');
  const qtyInput = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    step: 'any',
    value: '1',
  }) as HTMLInputElement;
  const unitInput = el('input', { class: 'input', type: 'text' }) as HTMLInputElement;
  const err = errorBox();

  const detailStep = el(
    'div',
    { class: 'pantry-form-detail hidden' },
    chosenLabel,
    field('quantity', qtyInput),
    field('unit', unitInput),
    ...(opts.extraFields ?? []),
    err,
  );

  function selectIngredient(ing: Ingredient): void {
    chosen = ing;
    unitInput.value = ing.defaultUnit;
    const alias = ing.aliases?.[0];
    chosenLabel.textContent = alias ? `${ing.name} · ${alias}` : ing.name;
    pickStep.classList.add('hidden');
    detailStep.classList.remove('hidden');
    hideError(err);
  }

  attachIngredientSearch(searchInput, searchResults, selectIngredient);

  const body = el('div', { class: 'pantry-form' }, pickStep, detailStep);

  function read(): { ingredient: Ingredient; quantity: number; unit: string } | null {
    if (!chosen) {
      showError(err, MSG_PICK_INGREDIENT);
      return null;
    }
    const parsed = readQuantityUnit(qtyInput, unitInput, err);
    if (!parsed) return null;
    return { ingredient: chosen, ...parsed };
  }

  return { body, pickStep, detailStep, qtyInput, unitInput, err, selectIngredient, read };
}
