// Cook feedback modal — four chip-row groups + an optional changes note, skippable.
//
// Validation mirrors the API's mergeFeedback exactly: usedAsIs === false requires a
// non-empty changesNote; usedAsIs === true must never send one (a note alongside
// true is a 400, not something the API repairs), so the key is omitted, not nulled.

import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';
import { el, button } from '../ui/dom.js';
import { saveFeedback } from '../api/meal-plans.js';
import { isApiError, userMessage } from '../api/errors.js';
import type {
  MealPlanEntry,
  FeedbackCreate,
  Rating,
  EffortCheck,
  MakeAgain,
} from '../api/types.js';

export interface FeedbackModalOptions {
  entry: MealPlanEntry;
  /** Header title — the design's "Cooked. N items deducted." when opened post-cook. */
  title: string;
  /** Fires once the modal is done, whether saved or skipped. */
  onDone?: () => void;
}

interface ChipOption<T extends string> {
  value: T;
  text: string;
}

/** A label + row of mutually-exclusive chips. Selection styling is handled inline. */
function chipGroup<T extends string>(
  label: string,
  options: ChipOption<T>[],
  onChange: (value: T) => void,
): HTMLElement {
  const buttons: HTMLButtonElement[] = [];
  const row = el('div', { class: 'cook-chip-row' });
  for (const opt of options) {
    const btn = button(
      'cook-chip',
      opt.text,
      () => {
        for (const b of buttons) b.classList.remove('is-selected');
        btn.classList.add('is-selected');
        onChange(opt.value);
      },
      { 'data-value': opt.value },
    );
    buttons.push(btn);
    row.appendChild(btn);
  }
  return el('div', { class: 'cook-chip-group' }, el('div', { class: 'form-label' }, label), row);
}

export function openFeedback(opts: FeedbackModalOptions): void {
  const state: {
    rating?: Rating;
    effortCheck?: EffortCheck;
    makeAgain?: MakeAgain;
    usedAsIs?: boolean;
  } = {};
  let changesNote = '';

  const ratingGroup = chipGroup<Rating>('worth it?', [
    { value: 'thumbs_up', text: '▲ yes' },
    { value: 'thumbs_down', text: '▼ no' },
  ], (v) => {
    state.rating = v;
    refresh();
  });

  const effortGroup = chipGroup<EffortCheck>('effort felt', [
    { value: 'felt_right', text: 'right' },
    { value: 'too_hard', text: 'too hard' },
    { value: 'too_easy', text: 'too easy' },
  ], (v) => {
    state.effortCheck = v;
    refresh();
  });

  const againGroup = chipGroup<MakeAgain>('make again', [
    { value: 'yes', text: 'yes' },
    { value: 'maybe', text: 'maybe' },
    { value: 'no', text: 'no' },
  ], (v) => {
    state.makeAgain = v;
    refresh();
  });

  const noteInput = el('textarea', {
    class: 'textarea cook-changes-note',
    placeholder: 'halved the cream, added dill at the end',
  });
  const noteError = el(
    'div',
    { class: 'helper helper-error hidden' },
    "changesNote is required when you didn't cook it as written",
  );
  const changesWrap = el(
    'div',
    { class: 'cook-changes hidden' },
    el('label', { class: 'form-label' }, 'what did you change? ', el('span', { class: 'label label-red' }, 'required')),
    noteInput,
    noteError,
  );
  noteInput.addEventListener('input', () => {
    changesNote = noteInput.value;
    refresh();
  });

  const asIsGroup = chipGroup<'as_is' | 'changed'>('cooked as written', [
    { value: 'as_is', text: 'as-is' },
    { value: 'changed', text: 'changed it' },
  ], (v) => {
    state.usedAsIs = v === 'as_is';
    changesWrap.classList.toggle('hidden', v === 'as_is');
    refresh();
  });

  /** changesNote is valid unless usedAsIs is false and the note is blank. */
  function noteValid(): boolean {
    return state.usedAsIs !== false || changesNote.trim().length > 0;
  }

  function refresh(): void {
    const invalidNote = state.usedAsIs === false && changesNote.trim().length === 0;
    noteInput.setAttribute('aria-invalid', invalidNote ? 'true' : 'false');
    noteError.classList.toggle('hidden', !invalidNote);

    const complete =
      state.rating !== undefined &&
      state.effortCheck !== undefined &&
      state.makeAgain !== undefined &&
      state.usedAsIs !== undefined;
    saveBtn.disabled = !complete || !noteValid();
  }

  const body = el('div', {}, ratingGroup, effortGroup, againGroup, asIsGroup, changesWrap);

  const skipBtn = button('btn btn-ghost cook-feedback-skip', 'skip', () => {
    closeModal();
    opts.onDone?.();
  });
  const saveBtn = button('btn btn-primary cook-feedback-save', 'save · tunes suggestions', () =>
    void handleSave(),
  );
  saveBtn.disabled = true;
  const footer = el('div', {}, saveBtn);

  const handle = openModal({ title: opts.title, body, footer, width: 420 });
  // The design puts a ghost "skip" in the header, but openModal's header only
  // renders title/meta text — append it directly onto the rendered head instead
  // of touching ui/modal.ts. justify-content:space-between then pins it right.
  handle.frame.querySelector('.modal-head')?.appendChild(skipBtn);

  async function handleSave(): Promise<void> {
    if (state.rating === undefined || state.effortCheck === undefined || state.makeAgain === undefined) {
      return;
    }
    if (state.usedAsIs === undefined || !noteValid()) return;

    const payload: FeedbackCreate = {
      rating: state.rating,
      effortCheck: state.effortCheck,
      makeAgain: state.makeAgain,
      usedAsIs: state.usedAsIs,
    };
    if (state.usedAsIs === false) payload.changesNote = changesNote.trim();

    saveBtn.disabled = true;
    try {
      await saveFeedback(opts.entry.id, payload);
      closeModal();
      say('Feedback saved.');
      opts.onDone?.();
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        say('Feedback already recorded.', 'error');
        closeModal();
        opts.onDone?.();
        return;
      }
      say(userMessage(err), 'error');
      saveBtn.disabled = false;
    }
  }
}
