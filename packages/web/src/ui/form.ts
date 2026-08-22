// Labeled field + helper-error box — shared form chrome next to el/button

import '../css/form.css';
import { el } from './dom.js';

/** A label stacked above a control. `.pantry-field` is the shared class. */
export function field(labelText: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'pantry-field' }, el('span', { class: 'form-label' }, labelText), control);
}

export function errorBox(): HTMLElement {
  return el('div', { class: 'helper-error hidden' });
}

/** Fill `box` with a message + optional detail lines and unhide it. */
export function showError(box: HTMLElement, message: string, details: string[] = []): void {
  box.replaceChildren(message, ...details.map((d) => el('div', {}, d)));
  box.classList.remove('hidden');
}

export function hideError(box: HTMLElement): void {
  box.classList.add('hidden');
}
