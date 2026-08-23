// Pantry add and edit item modals.

import type { Ingredient, PantryItem, PantryLocation, PantryCreate } from '../api/types.js';
import { LOCATIONS } from '../api/types.js';
import { createPantryItem, patchPantryItem, deletePantryItem } from '../api/pantry.js';
import { userMessage, fieldErrors, isApiError } from '../api/errors.js';
import { el, button } from '../ui/dom.js';
import { field, errorBox, showError } from '../ui/form.js';
import { createIngredientQuantityForm, readQuantityUnit } from '../ui/ingredient-picker.js';
import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';

const NO_SHELF_LIFE =
  'expiresDate is required when ingredient has no shelf life for this location';

function locationSelect(initial: PantryLocation): HTMLSelectElement {
  const sel = el('select', { class: 'select' });
  for (const loc of LOCATIONS) {
    sel.appendChild(el('option', { value: loc, selected: loc === initial }, loc));
  }
  return sel as HTMLSelectElement;
}

export interface AddItemHandlers {
  onCreated: (row: PantryItem, ingredient: Ingredient) => void;
}

/** `preset` skips the search step — used when the sticky-bar picker already chose one. */
export function openAddItemModal(handlers: AddItemHandlers, preset?: Ingredient): void {
  const locSelect = locationSelect('fridge');
  const openedInput = el('input', { class: 'checkbox', type: 'checkbox' }) as HTMLInputElement;
  const expiresInput = el('input', { class: 'input', type: 'date' }) as HTMLInputElement;
  const expiresField = field('expires (no shelf life on file for this location)', expiresInput);
  expiresField.classList.add('hidden');

  const form = createIngredientQuantityForm({
    extraFields: [
      field('location', locSelect),
      el('label', { class: 'flex items-center gap-2' }, openedInput, 'opened'),
      expiresField,
    ],
  });
  if (preset) form.selectIngredient(preset);

  async function submit(): Promise<void> {
    const parsed = form.read();
    if (!parsed) return;
    const payload: PantryCreate = {
      ingredientId: parsed.ingredient.id,
      quantity: parsed.quantity,
      unit: parsed.unit,
      location: locSelect.value as PantryLocation,
      opened: openedInput.checked,
    };
    if (!expiresField.classList.contains('hidden') && expiresInput.value) {
      payload.expiresDate = expiresInput.value;
    }
    try {
      const row = await createPantryItem(payload);
      say(`${parsed.ingredient.name} added to pantry`, 'success');
      closeModal();
      handlers.onCreated(row, parsed.ingredient);
    } catch (e) {
      if (isApiError(e) && e.status === 400 && e.body?.error === NO_SHELF_LIFE) {
        expiresField.classList.remove('hidden');
      }
      showError(form.err, userMessage(e), fieldErrors(e));
    }
  }

  const footer = el(
    'div',
    { class: 'flex gap-2' },
    button('btn btn-ghost', 'cancel', () => closeModal()),
    button('btn btn-primary', 'save', () => void submit()),
  );

  openModal({ title: 'Add pantry item', body: form.body, footer, width: 420, onClose: form.detach });
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
    const parsed = readQuantityUnit(qtyInput, unitInput, err);
    if (!parsed) return;
    try {
      const row = await patchPantryItem(item.id, {
        quantity: parsed.quantity,
        unit: parsed.unit,
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
