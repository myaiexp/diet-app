// Add / edit pantry item modals: debounced catalog search, quantity form,
// and the shelf-life fallback (API 400 -> reveal an expiresDate field).

import type { Ingredient, PantryItem, PantryLocation, PantryCreate } from '../api/types.js';
import { LOCATIONS } from '../api/types.js';
import { searchIngredients } from '../api/ingredients.js';
import { createPantryItem, patchPantryItem, deletePantryItem } from '../api/pantry.js';
import { userMessage, fieldErrors, isApiError } from '../api/errors.js';
import { el, button } from '../ui/dom.js';
import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 8;
const NO_SHELF_LIFE =
  'expiresDate is required when ingredient has no shelf life for this location';

function field(labelText: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'pantry-field' }, el('span', { class: 'form-label' }, labelText), control);
}

function errorBox(): HTMLElement {
  return el('div', { class: 'helper-error hidden' });
}

function showError(box: HTMLElement, message: string, details: string[] = []): void {
  box.replaceChildren(message, ...details.map((d) => el('div', {}, d)));
  box.classList.remove('hidden');
}

function locationSelect(initial: PantryLocation): HTMLSelectElement {
  const sel = el('select', { class: 'select' });
  for (const loc of LOCATIONS) {
    sel.appendChild(el('option', { value: loc, selected: loc === initial }, loc));
  }
  return sel as HTMLSelectElement;
}

/** Debounced catalog search wired to an input + a results list under it. */
export function attachIngredientSearch(
  input: HTMLInputElement,
  results: HTMLElement,
  onPick: (ing: Ingredient) => void,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function runSearch(q: string): Promise<void> {
    const needle = q.trim();
    if (!needle) {
      results.replaceChildren();
      return;
    }
    let matches: Ingredient[];
    try {
      matches = await searchIngredients(needle, SEARCH_LIMIT);
    } catch (e) {
      say(userMessage(e), 'error');
      return;
    }
    results.replaceChildren();
    if (matches.length === 0) {
      results.appendChild(el('div', { class: 'pantry-search-empty' }, 'no matches'));
      return;
    }
    for (const ing of matches) {
      const alias = ing.aliases?.[0];
      const row = button('pantry-search-result', '', () => onPick(ing));
      row.append(el('span', {}, ing.name), alias ? el('span', { class: 'pantry-alias' }, alias) : '');
      results.appendChild(row);
    }
  }

  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    const q = input.value;
    timer = setTimeout(() => void runSearch(q), SEARCH_DEBOUNCE_MS);
  });
}

export interface AddItemHandlers {
  onCreated: (row: PantryItem, ingredient: Ingredient) => void;
}

/** `preset` skips the search step — used when the sticky-bar picker already chose one. */
export function openAddItemModal(handlers: AddItemHandlers, preset?: Ingredient): void {
  let chosen: Ingredient | null = preset ?? null;

  const searchInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'search ingredients — peruna, potato…',
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
  const locSelect = locationSelect('fridge');
  const openedInput = el('input', { class: 'checkbox', type: 'checkbox' }) as HTMLInputElement;
  const expiresInput = el('input', { class: 'input', type: 'date' }) as HTMLInputElement;
  const expiresField = field('expires (no shelf life on file for this location)', expiresInput);
  expiresField.classList.add('hidden');
  const err = errorBox();

  const detailStep = el(
    'div',
    { class: 'pantry-form-detail hidden' },
    chosenLabel,
    field('quantity', qtyInput),
    field('unit', unitInput),
    field('location', locSelect),
    el('label', { class: 'flex items-center gap-2' }, openedInput, 'opened'),
    expiresField,
    err,
  );

  function selectIngredient(ing: Ingredient): void {
    chosen = ing;
    unitInput.value = ing.defaultUnit;
    const alias = ing.aliases?.[0];
    chosenLabel.textContent = alias ? `${ing.name} · ${alias}` : ing.name;
    pickStep.classList.add('hidden');
    detailStep.classList.remove('hidden');
    err.classList.add('hidden');
  }

  attachIngredientSearch(searchInput, searchResults, selectIngredient);

  const body = el('div', { class: 'pantry-form' }, pickStep, detailStep);

  async function submit(): Promise<void> {
    if (!chosen) {
      showError(err, 'Pick an ingredient first.');
      return;
    }
    const quantity = Number(qtyInput.value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showError(err, 'Quantity must be a positive number.');
      return;
    }
    const unit = unitInput.value.trim();
    if (!unit) {
      showError(err, 'Unit is required.');
      return;
    }
    const payload: PantryCreate = {
      ingredientId: chosen.id,
      quantity,
      unit,
      location: locSelect.value as PantryLocation,
      opened: openedInput.checked,
    };
    if (!expiresField.classList.contains('hidden') && expiresInput.value) {
      payload.expiresDate = expiresInput.value;
    }
    try {
      const row = await createPantryItem(payload);
      say(`${chosen.name} added to pantry`, 'success');
      closeModal();
      handlers.onCreated(row, chosen);
    } catch (e) {
      if (isApiError(e) && e.status === 400 && e.body?.error === NO_SHELF_LIFE) {
        expiresField.classList.remove('hidden');
      }
      showError(err, userMessage(e), fieldErrors(e));
    }
  }

  const footer = el(
    'div',
    { class: 'flex gap-2' },
    button('btn btn-ghost', 'cancel', () => closeModal()),
    button('btn btn-primary', 'save', () => void submit()),
  );

  if (preset) selectIngredient(preset);
  openModal({ title: 'Add pantry item', body, footer, width: 420 });
}

export interface EditItemHandlers {
  onSaved: (row: PantryItem) => void;
  onDeleted: (id: string) => void;
}

export function openEditItemModal(
  item: PantryItem,
  ingredient: Ingredient | undefined,
  handlers: EditItemHandlers,
): void {
  const qtyInput = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    step: 'any',
    value: item.quantity,
  }) as HTMLInputElement;
  const unitInput = el('input', { class: 'input', type: 'text', value: item.unit }) as HTMLInputElement;
  const locSelect = locationSelect(item.location);
  const openedInput = el('input', {
    class: 'checkbox',
    type: 'checkbox',
    checked: item.opened ?? false,
  }) as HTMLInputElement;
  const expiresInput = el('input', {
    class: 'input',
    type: 'date',
    value: item.expiresDate.slice(0, 10),
  }) as HTMLInputElement;
  const err = errorBox();

  const body = el(
    'div',
    { class: 'pantry-form' },
    field('quantity', qtyInput),
    field('unit', unitInput),
    field('location', locSelect),
    el('label', { class: 'flex items-center gap-2' }, openedInput, 'opened'),
    field('expires', expiresInput),
    err,
  );

  async function submit(): Promise<void> {
    const quantity = Number(qtyInput.value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showError(err, 'Quantity must be a positive number.');
      return;
    }
    const unit = unitInput.value.trim();
    if (!unit) {
      showError(err, 'Unit is required.');
      return;
    }
    try {
      const row = await patchPantryItem(item.id, {
        quantity,
        unit,
        location: locSelect.value as PantryLocation,
        opened: openedInput.checked,
        expiresDate: expiresInput.value,
      });
      say('Pantry item updated', 'success');
      closeModal();
      handlers.onSaved(row);
    } catch (e) {
      showError(err, userMessage(e), fieldErrors(e));
    }
  }

  async function remove(): Promise<void> {
    try {
      await deletePantryItem(item.id);
      say('Pantry item removed', 'success');
      closeModal();
      handlers.onDeleted(item.id);
    } catch (e) {
      showError(err, userMessage(e));
    }
  }

  const footer = el(
    'div',
    { class: 'flex gap-2' },
    button('btn btn-ghost', 'delete', () => void remove()),
    button('btn btn-ghost', 'cancel', () => closeModal()),
    button('btn btn-primary', 'save', () => void submit()),
  );

  openModal({ title: `Edit ${ingredient?.name ?? 'pantry item'}`, body, footer, width: 380 });
}
