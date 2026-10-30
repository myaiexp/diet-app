// Pantry add and edit item modals.

import type { Ingredient, PantryItem, PantryLocation, PantryCreate, PantryPatch } from '../api/types.js';
import { LOCATIONS } from '../api/types.js';
import { createPantryItem, getPantryItem, patchPantryItem, deletePantryItem } from '../api/pantry.js';
import { isApiError } from '../api/errors.js';
import { formatQuantity, toNumber } from '../format/quantity.js';
import { el, button } from '../ui/dom.js';
import { field, errorBox, selectInput, showError } from '../ui/form.js';
import { createIngredientQuantityForm, readQuantityUnit } from '../ui/ingredient-picker.js';
import { closeModal, openModal } from '../ui/modal.js';
import { modalFooter, submitModal } from '../ui/modal-form.js';
import { say } from '../ui/toast.js';

const NO_SHELF_LIFE =
  'expiresDate is required when ingredient has no shelf life for this location';

export interface AddItemHandlers {
  onCreated: (row: PantryItem, ingredient: Ingredient) => void;
}

/** `preset` skips the search step — used when the sticky-bar picker already chose one. */
export function openAddItemModal(handlers: AddItemHandlers, preset?: Ingredient): void {
  const locSelect = selectInput(LOCATIONS, 'fridge');
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
    const { ingredient } = parsed;
    await submitModal(() => createPantryItem(payload), {
      errorBox: form.err,
      success: `${ingredient.name} added to pantry`,
      onError: (e) => {
        if (isApiError(e) && e.status === 400 && e.body?.error === NO_SHELF_LIFE) {
          expiresField.classList.remove('hidden');
        }
      },
      onDone: (row) => handlers.onCreated(row, ingredient),
    });
  }

  const footer = modalFooter({ label: 'save', onClick: () => void submit() });

  openModal({ title: 'Add pantry item', body: form.body, footer, width: 420, onClose: form.detach });
}

export interface EditItemHandlers {
  onSaved: (row: PantryItem) => void;
  onDeleted: (id: string) => void;
}

type EditFields = Required<Pick<PantryPatch, 'quantity' | 'unit' | 'location' | 'opened' | 'expiresDate'>>;

/**
 * Only what the user changed. POST /cook moves quantity while this dialog can
 * sit open, so a field sent back unchanged would overwrite a deduction that
 * cannot be re-run; a changed quantity names the value it replaces.
 */
function changedFields(base: PantryItem, form: EditFields): PantryPatch {
  const patch: PantryPatch = {};
  const baseQuantity = toNumber(base.quantity);
  if (form.quantity !== baseQuantity) {
    patch.quantity = form.quantity;
    patch.expectedQuantity = baseQuantity;
  }
  if (form.unit !== base.unit) patch.unit = form.unit;
  if (form.location !== base.location) patch.location = form.location;
  if (form.opened !== (base.opened ?? false)) patch.opened = form.opened;
  if (form.expiresDate !== base.expiresDate.slice(0, 10)) patch.expiresDate = form.expiresDate;
  return patch;
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
  const locSelect = selectInput(LOCATIONS, item.location);
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
  let base = item;

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
    const patch = changedFields(base, {
      quantity: parsed.quantity,
      unit: parsed.unit,
      location: locSelect.value as PantryLocation,
      opened: openedInput.checked,
      expiresDate: expiresInput.value,
    });
    if (Object.keys(patch).length === 0) {
      closeModal();
      return;
    }
    await submitModal(() => patchPantryItem(item.id, patch), {
      errorBox: err,
      success: 'Pantry item updated',
      onError: (e) => {
        if (!isApiError(e)) return;
        if (e.status === 409) void rebase();
        if (e.status === 404) {
          closeModal();
          say('That pantry item is gone — it was used up or removed');
          handlers.onDeleted(item.id);
        }
      },
      onDone: handlers.onSaved,
    });
  }

  /** The row moved under the dialog: show its new quantity and compare the next save against it. */
  async function rebase(): Promise<void> {
    let fresh: PantryItem;
    try {
      fresh = await getPantryItem(item.id);
    } catch {
      return; // The 409 is already on screen; the next save will 409 again.
    }
    base = fresh;
    handlers.onSaved(fresh);
    const now = formatQuantity(toNumber(fresh.quantity), fresh.unit);
    showError(err, `Quantity is now ${now} — check it and save again.`);
  }

  async function remove(): Promise<void> {
    await submitModal(() => deletePantryItem(item.id), {
      errorBox: err,
      success: 'Pantry item removed',
      onDone: () => handlers.onDeleted(item.id),
    });
  }

  const footer = modalFooter({ label: 'save', onClick: () => void submit() }, [
    button('btn btn-ghost', 'delete', () => void remove()),
  ]);

  openModal({ title: `Edit ${ingredient?.name ?? 'pantry item'}`, body, footer, width: 380 });
}
