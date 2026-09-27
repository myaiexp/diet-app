// Modal form chrome: cancel/primary footer and submitModal's close-on-success.

import { describe, test, expect, vi, afterEach } from 'vitest';
import { el, button } from '../ui/dom.js';
import { errorBox } from '../ui/form.js';
import { openModal, closeModal, isModalOpen } from '../ui/modal.js';
import { modalFooter, submitModal } from '../ui/modal-form.js';
import { ApiError } from '../api/errors.js';
import { clearToast } from '../ui/toast.js';

afterEach(() => {
  closeModal();
  clearToast();
});

describe('modalFooter', () => {
  test('leading actions, then cancel, then the primary with its extra class', () => {
    const onClick = vi.fn();
    const footer = modalFooter({ label: 'save', class: 'plan-edit-save', onClick }, [
      button('btn btn-ghost', 'delete', () => {}),
    ]);
    const buttons = [...footer.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['delete', 'cancel', 'save']);
    expect(buttons[2]!.className).toBe('btn btn-primary plan-edit-save');
    buttons[2]!.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  test('cancel closes the open modal', () => {
    const footer = modalFooter({ label: 'save', onClick: () => {} });
    openModal({ title: 't', body: el('div', {}), footer });
    expect(isModalOpen()).toBe(true);
    footer.querySelector<HTMLButtonElement>('.btn-ghost')!.click();
    expect(isModalOpen()).toBe(false);
  });
});

describe('submitModal', () => {
  test('success closes the modal before onDone runs', async () => {
    openModal({ title: 't', body: el('div', {}) });
    let openDuringDone: boolean | undefined;
    await submitModal(() => Promise.resolve('row'), {
      onDone: () => {
        openDuringDone = isModalOpen();
      },
    });
    expect(openDuringDone).toBe(false);
  });

  test('failure leaves the modal open with the error in its box', async () => {
    const box = errorBox();
    openModal({ title: 't', body: el('div', {}, box) });
    const ok = await submitModal(() => Promise.reject(new ApiError(500, null)), {
      errorBox: box,
      onDone: () => {},
    });
    expect(ok).toBe(false);
    expect(isModalOpen()).toBe(true);
    expect(box.classList.contains('hidden')).toBe(false);
  });
});
