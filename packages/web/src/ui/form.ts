// Labeled field + helper-error box — shared form chrome next to el/button

import '../css/form.css';
import { el } from './dom.js';

export interface FieldOptions {
  /** Default `'div'` is the pantry-field stack (label span above the control). `'label'` wraps the control as a form-label. */
  as?: 'div' | 'label';
  /** Extra classes on the wrapper (e.g. `'import-field'`, `'profile-field'`). */
  class?: string;
}

/** Label + control. The two wrappers screens had been copy-pasting independently. */
export function field(label: string, control: HTMLElement, opts: FieldOptions = {}): HTMLElement {
  const extra = opts.class;
  if (opts.as === 'label') {
    return el('label', { class: extra ? `form-label ${extra}` : 'form-label' }, label, control);
  }
  return el(
    'div',
    { class: extra ? `pantry-field ${extra}` : 'pantry-field' },
    el('span', { class: 'form-label' }, label),
    control,
  );
}

export function errorBox(opts: { class?: string } = {}): HTMLElement {
  const extra = opts.class;
  return el('div', { class: extra ? `helper-error hidden ${extra}` : 'helper-error hidden' });
}

/** Fill `box` with a message + optional detail lines and unhide it. */
export function showError(box: HTMLElement, message: string, details: string[] = []): void {
  box.replaceChildren(message, ...details.map((d) => el('div', {}, d)));
  box.classList.remove('hidden');
}

export function hideError(box: HTMLElement): void {
  box.classList.add('hidden');
}
