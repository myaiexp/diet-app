// Ad-hoc add modal: shared pick-then-quantity form plus an optional note.

import type { ShoppingItem, ShoppingItemCreate } from '../api/types.js';
import { addShoppingItem } from '../api/shopping.js';
import { el } from '../ui/dom.js';
import { field } from '../ui/form.js';
import { createIngredientQuantityForm } from '../ui/ingredient-picker.js';
import { openModal } from '../ui/modal.js';
import { modalFooter, submitModal } from '../ui/modal-form.js';

export interface AddShoppingItemHandlers {
  onCreated: (item: ShoppingItem) => void;
}

export function openAddShoppingItemModal(listId: string, handlers: AddShoppingItemHandlers): void {
  const noteInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'note (optional)',
  }) as HTMLInputElement;
  const form = createIngredientQuantityForm({ extraFields: [field('note', noteInput)] });

  async function submit(): Promise<void> {
    const parsed = form.read();
    if (!parsed) return;
    const note = noteInput.value.trim();
    const payload: ShoppingItemCreate = {
      ingredientId: parsed.ingredient.id,
      quantityNeeded: parsed.quantity,
      unit: parsed.unit,
    };
    if (note) payload.customNote = note;

    // The 409 duplicate ("An item for this ingredient and unit already
    // exists") and the 400s ("Unrecognized unit", "Invalid reference") all
    // come through userMessage verbatim — the API's own text is the most
    // specific thing there is here.
    await submitModal(() => addShoppingItem(listId, payload), {
      errorBox: form.err,
      success: `${parsed.ingredient.name} added to the list`,
      onDone: handlers.onCreated,
    });
  }

  const footer = modalFooter({ label: 'save', onClick: () => void submit() });

  openModal({ title: 'Add to shopping list', body: form.body, footer, width: 380, onClose: form.detach });
}
