// Ad-hoc add modal: catalog search (reused from pantry-form.ts), quantity,
// unit prefilled from the ingredient's default, and an optional note.

import type { Ingredient, ShoppingItem, ShoppingItemCreate } from '../api/types.js';
import { addShoppingItem } from '../api/shopping.js';
import { attachIngredientSearch } from './pantry-form.js';
import { userMessage, fieldErrors } from '../api/errors.js';
import { el, button } from '../ui/dom.js';
import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';

export interface AddShoppingItemHandlers {
  onCreated: (item: ShoppingItem) => void;
}

// .pantry-field / .pantry-form / .pantry-chosen / .helper-error / .form-label
// are already a de facto shared form vocabulary (plan-cell.ts and
// add-entry.ts reuse .pantry-field the same way) — no shopping-specific CSS
// needed for the form shell itself.
function field(labelText: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'pantry-field' }, el('span', { class: 'form-label' }, labelText), control);
}

export function openAddShoppingItemModal(listId: string, handlers: AddShoppingItemHandlers): void {
  let chosen: Ingredient | null = null;

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
  const noteInput = el('input', { class: 'input', type: 'text', placeholder: 'note (optional)' }) as HTMLInputElement;
  const err = el('div', { class: 'helper-error hidden' });

  const detailStep = el(
    'div',
    { class: 'pantry-form-detail hidden' },
    chosenLabel,
    field('quantity', qtyInput),
    field('unit', unitInput),
    field('note', noteInput),
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

  function showError(message: string, details: string[] = []): void {
    err.replaceChildren(message, ...details.map((d) => el('div', {}, d)));
    err.classList.remove('hidden');
  }

  async function submit(): Promise<void> {
    if (!chosen) {
      showError('Pick an ingredient first.');
      return;
    }
    const quantityNeeded = Number(qtyInput.value);
    if (!Number.isFinite(quantityNeeded) || quantityNeeded <= 0) {
      showError('Quantity must be a positive number.');
      return;
    }
    const unit = unitInput.value.trim();
    if (!unit) {
      showError('Unit is required.');
      return;
    }
    const note = noteInput.value.trim();
    const payload: ShoppingItemCreate = { ingredientId: chosen.id, quantityNeeded, unit };
    if (note) payload.customNote = note;

    try {
      const item = await addShoppingItem(listId, payload);
      say(`${chosen.name} added to the list`, 'success');
      closeModal();
      handlers.onCreated(item);
    } catch (e) {
      // The 409 duplicate ("An item for this ingredient and unit already
      // exists") and the 400s ("Unrecognized unit", "Invalid reference") all
      // come through userMessage verbatim — the API's own text is the most
      // specific thing there is here.
      showError(userMessage(e), fieldErrors(e));
    }
  }

  const footer = el(
    'div',
    { class: 'flex gap-2' },
    button('btn btn-ghost', 'cancel', () => closeModal()),
    button('btn btn-primary', 'save', () => void submit()),
  );

  openModal({ title: 'Add to shopping list', body, footer, width: 380 });
}
