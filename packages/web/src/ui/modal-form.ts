// Modal form chrome: the cancel/primary footer and the submit-then-close write

import { el, button } from './dom.js';
import { closeModal } from './modal.js';
import { submitForm, type SubmitOptions } from './form.js';

export interface FooterAction {
  label: string;
  onClick: () => void;
  /** Extra classes on top of `btn btn-primary` (test hooks like `add-entry-save`). */
  class?: string;
}

/** `[...leading] cancel primary`; cancel closes the modal. `leading` holds secondary actions (pantry delete). */
export function modalFooter(primary: FooterAction, leading: HTMLElement[] = []): HTMLElement {
  return el(
    'div',
    { class: 'flex gap-2' },
    ...leading,
    button('btn btn-ghost', 'cancel', () => closeModal()),
    button(primary.class ? `btn btn-primary ${primary.class}` : 'btn btn-primary', primary.label, () =>
      primary.onClick(),
    ),
  );
}

/** `submitForm` that closes the modal on success, before `onDone` re-renders the screen behind it. */
export function submitModal<T>(run: () => Promise<T>, opts: SubmitOptions<T>): Promise<boolean> {
  return submitForm(run, {
    ...opts,
    onDone: (result) => {
      closeModal();
      opts.onDone(result);
    },
  });
}
