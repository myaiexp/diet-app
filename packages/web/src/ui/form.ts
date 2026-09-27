// Form chrome next to el/button: labeled field, helper-error box, inputs, submit

import '../css/form.css';
import { el, type Attrs } from './dom.js';
import { say } from './toast.js';
import { userMessage, fieldErrors } from '../api/errors.js';

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

/** `attrs` with its `class` appended to `base` rather than replacing it. */
function withBaseClass(base: string, attrs: Attrs): Attrs {
  const extra = typeof attrs.class === 'string' ? attrs.class : '';
  return { ...attrs, class: extra ? `${base} ${extra}` : base };
}

/**
 * `class` is extra classes on top of `.input`. `onChange` is opt-in — omit it
 * for an uncontrolled field (recipe edit); pass it to self-wire `change`.
 */
export function textInput(
  value: string | number,
  attrs: Attrs = {},
  onChange?: (value: string) => void,
): HTMLInputElement {
  const input = el('input', { type: 'text', value, ...withBaseClass('input', attrs) }) as HTMLInputElement;
  if (onChange) input.addEventListener('change', () => onChange(input.value));
  return input;
}

/** A `.select` over a closed option set, `current` preselected. `class` adds to `.select`. */
export function selectInput<T extends string>(
  options: readonly T[],
  current: T | null | undefined,
  attrs: Attrs = {},
): HTMLSelectElement {
  const sel = el('select', withBaseClass('select', attrs)) as HTMLSelectElement;
  for (const o of options) sel.appendChild(el('option', { value: o, selected: o === current }, o));
  return sel;
}

export interface SubmitOptions<T> {
  /** Where a failure shows. Omitted → an error toast (a bare confirm has no form to hold one). */
  errorBox?: HTMLElement;
  /** Success toast, fixed or built from the result. Omitted → none. */
  success?: string | ((result: T) => string);
  /** Runs before the failure is shown: reveal a field, re-enable a button. */
  onError?: (e: unknown) => void;
  onDone: (result: T) => void;
}

/**
 * Run one write: on success toast, hide the error box, then `onDone`; on
 * failure `userMessage` + `fieldErrors` into the box. `onDone` runs outside the
 * catch, so a throw in the caller's re-render surfaces as the bug it is rather
 * than as "save failed" for a write that landed. Resolves whether it succeeded.
 */
export async function submitForm<T>(run: () => Promise<T>, opts: SubmitOptions<T>): Promise<boolean> {
  let result: T;
  try {
    result = await run();
  } catch (e) {
    opts.onError?.(e);
    if (opts.errorBox) showError(opts.errorBox, userMessage(e), fieldErrors(e));
    else say(userMessage(e), 'error');
    return false;
  }
  if (opts.errorBox) hideError(opts.errorBox);
  if (opts.success !== undefined) {
    say(typeof opts.success === 'string' ? opts.success : opts.success(result));
  }
  opts.onDone(result);
  return true;
}
