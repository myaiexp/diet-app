// Form chrome: field wrappers, helper-error box, text/select inputs, submitForm.

import { describe, test, expect, vi, afterEach } from 'vitest';
import { el } from '../ui/dom.js';
import { field, errorBox, showError, hideError, textInput, selectInput, submitForm } from '../ui/form.js';
import { ApiError } from '../api/errors.js';
import { clearToast } from '../ui/toast.js';

afterEach(() => clearToast());

describe('field', () => {
  test('wraps a control in pantry-field chrome with a form-label', () => {
    const input = el('input', { class: 'input', type: 'text' });
    const wrap = field('quantity', input);
    expect(wrap.className).toBe('pantry-field');
    expect(wrap.querySelector('.form-label')?.textContent).toBe('quantity');
    expect(wrap.querySelector('input')).toBe(input);
  });

  test('as: label wraps the control in a form-label', () => {
    const control = el('input', { class: 'input' });
    const node = field('title', control, { as: 'label' });
    expect(node.tagName).toBe('LABEL');
    expect(node.className).toBe('form-label');
    expect(node.contains(control)).toBe(true);
  });

  test('extra class lands on the wrapper of either variant', () => {
    const input = el('input', {});
    expect(field('kcal min', input, { as: 'label', class: 'profile-field' }).className).toBe(
      'form-label profile-field',
    );
    expect(field('unit', el('input', {}), { class: 'extra' }).className).toBe('pantry-field extra');
  });
});

describe('errorBox / showError', () => {
  test('starts hidden, then unhides with the message and detail lines', () => {
    const box = errorBox();
    expect(box.classList.contains('helper-error')).toBe(true);
    expect(box.classList.contains('hidden')).toBe(true);

    showError(box, 'Quantity must be a positive number.', ['unit: required']);
    expect(box.classList.contains('hidden')).toBe(false);
    expect(box.textContent).toContain('Quantity must be a positive number.');
    expect(box.textContent).toContain('unit: required');

    hideError(box);
    expect(box.classList.contains('hidden')).toBe(true);
  });

  test('replaceChildren on a second call, so stale details do not linger', () => {
    const box = errorBox();
    showError(box, 'first', ['old']);
    showError(box, 'second');
    expect(box.textContent).toBe('second');
  });

  test('keeps an extra class alongside the defaults', () => {
    const box = errorBox({ class: 'helper' });
    expect(box.classList.contains('helper-error')).toBe(true);
    expect(box.classList.contains('hidden')).toBe(true);
    expect(box.classList.contains('helper')).toBe(true);
  });
});

describe('textInput', () => {
  test('returns an uncontrolled .input with the given value', () => {
    const input = textInput('Leek');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input.className).toBe('input');
    expect(input.value).toBe('Leek');
    expect(input.type).toBe('text');
  });

  test('composes an extra class and passes through attrs', () => {
    const input = textInput(1.5, { class: 'edit-qty-input', type: 'number', step: 'any' });
    expect(input.className).toBe('input edit-qty-input');
    expect(input.type).toBe('number');
    expect(input.getAttribute('step')).toBe('any');
    expect(input.value).toBe('1.5');
  });

  test('wires onChange only when a handler is passed', () => {
    const seen: string[] = [];
    const wired = textInput('a', { class: 'import-qty' }, (v) => seen.push(v));
    wired.value = 'b';
    wired.dispatchEvent(new Event('change'));
    expect(seen).toEqual(['b']);

    const plain = textInput('a');
    plain.value = 'c';
    expect(() => plain.dispatchEvent(new Event('change'))).not.toThrow();
  });
});

describe('selectInput', () => {
  test('one option per value, current preselected, extra class composed', () => {
    const sel = selectInput(['fridge', 'freezer', 'pantry'] as const, 'freezer', { class: 'plan-edit-status' });
    expect(sel.className).toBe('select plan-edit-status');
    expect([...sel.options].map((o) => o.value)).toEqual(['fridge', 'freezer', 'pantry']);
    expect(sel.value).toBe('freezer');
  });

  test('no current value leaves the browser default (first option)', () => {
    expect(selectInput(['a', 'b'], null).value).toBe('a');
  });
});

describe('submitForm', () => {
  test('success: toasts, hides a stale error, then hands the result to onDone', async () => {
    const box = errorBox();
    showError(box, 'old failure');
    const onDone = vi.fn();
    const ok = await submitForm(() => Promise.resolve({ id: 'x' }), {
      errorBox: box,
      success: (r) => `saved ${r.id}`,
      onDone,
    });
    expect(ok).toBe(true);
    expect(onDone).toHaveBeenCalledWith({ id: 'x' });
    expect(box.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.toast')?.textContent).toBe('saved x');
  });

  test('failure: onError first, then message + field errors in the box; onDone never runs', async () => {
    const box = errorBox();
    const order: string[] = [];
    const ok = await submitForm(
      () =>
        Promise.reject(
          new ApiError(400, { error: 'Validation failed', details: { fieldErrors: { unit: ['required'] } } }),
        ),
      {
        errorBox: box,
        success: 'nope',
        onError: () => order.push(box.classList.contains('hidden') ? 'onError-before-show' : 'late'),
        onDone: () => order.push('done'),
      },
    );
    expect(ok).toBe(false);
    expect(order).toEqual(['onError-before-show']);
    expect(box.textContent).toContain('Validation failed');
    expect(box.textContent).toContain('unit: required');
    expect(document.querySelector('.toast')).toBeNull();
  });

  test('failure without an errorBox toasts the message as an error', async () => {
    await submitForm(() => Promise.reject(new ApiError(409, { error: 'already completed' })), { onDone: () => {} });
    const toast = document.querySelector('.toast');
    expect(toast?.textContent).toBe('already completed');
    expect(toast?.className).toContain('toast-error');
  });

  test('a throw in onDone propagates — never reported as a failed write', async () => {
    const box = errorBox();
    await expect(
      submitForm(() => Promise.resolve(1), {
        errorBox: box,
        onDone: () => {
          throw new Error('render bug');
        },
      }),
    ).rejects.toThrow('render bug');
    expect(box.classList.contains('hidden')).toBe(true);
  });
});
