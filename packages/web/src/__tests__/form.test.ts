// Labeled-field + helper-error chrome shared by pantry, shopping, plan.

import { describe, test, expect } from 'vitest';
import { el } from '../ui/dom.js';
import { field, errorBox, showError, hideError } from '../ui/form.js';

describe('field', () => {
  test('wraps a control in pantry-field chrome with a form-label', () => {
    const input = el('input', { class: 'input', type: 'text' });
    const wrap = field('quantity', input);
    expect(wrap.className).toBe('pantry-field');
    expect(wrap.querySelector('.form-label')?.textContent).toBe('quantity');
    expect(wrap.querySelector('input')).toBe(input);
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
});
