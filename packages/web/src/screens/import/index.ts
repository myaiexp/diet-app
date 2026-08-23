// Recipe import: paste → extracting → review. Three sequential stages of one
// screen (not tabs) — the design's tab strip is a mockup affordance.

import type { Screen, ScreenContext } from '../../router.js';
import { el, button, errorPanel } from '../../ui/dom.js';
import { extractDraft } from '../../api/recipe-import.js';
import { userMessage, fieldErrors } from '../../api/errors.js';
import type { RecipeDraft } from '../../api/types.js';
import { mountReview } from './review.js';
import '../../css/import.css';

type Stage = 'paste' | 'extracting' | 'review';

const SHIMMER_WIDTHS = [72, 54, 88, 41, 66];

export function importScreen(): Screen {
  let rootEl: HTMLElement;
  let ctx: ScreenContext;
  let stage: Stage = 'paste';
  let url = '';
  let text = '';
  let draft: RecipeDraft | null = null;
  /** URL fetch was capped — review must warn; paste never sets this. */
  let truncated = false;
  let error: string | null = null;
  let errorDetails: string[] = [];
  /** Bumped on cancel so a stale extract response can't override the stage. */
  let token = 0;
  let teardownReview: (() => void) | null = null;

  function render(): void {
    teardownReview?.();
    teardownReview = null;
    rootEl.replaceChildren();
    if (stage === 'paste') rootEl.appendChild(renderPaste());
    else if (stage === 'extracting') rootEl.appendChild(renderExtracting());
    else if (draft) {
      if (truncated) {
        rootEl.appendChild(
          el(
            'p',
            { class: 'helper-error import-truncated', role: 'status' },
            'The source page was truncated before extraction — later steps or ingredients may be missing.',
          ),
        );
      }
      teardownReview = mountReview(rootEl, ctx, draft);
    }
  }

  function renderPaste(): HTMLElement {
    const panel = el('div', { class: 'panel panel-pad import-paste' });
    if (error) {
      panel.appendChild(
        errorPanel(error, () => {
          error = null;
          errorDetails = [];
          render();
        }),
      );
      if (errorDetails.length) {
        panel.appendChild(
          el('ul', { class: 'helper-error import-field-errors' }, ...errorDetails.map((m) => el('li', {}, m))),
        );
      }
    }

    const urlInput = el('input', {
      class: 'input',
      placeholder: 'https://www.k-ruoka.fi/reseptit/ohrarisotto-metsasienilla',
      value: url,
    });
    urlInput.addEventListener('input', () => (url = urlInput.value));

    const textArea = el(
      'textarea',
      { class: 'textarea import-paste-text', placeholder: 'or paste raw text', rows: 6 },
      text,
    );
    textArea.addEventListener('input', () => (text = textArea.value));

    panel.append(
      el('label', { class: 'form-label' }, 'source url', urlInput),
      el('label', { class: 'form-label' }, 'or paste raw text', textArea),
      button('btn btn-primary', 'extract draft', () => void submit()),
      el('p', { class: 'helper' }, 'nothing is saved until you approve the review step'),
    );
    return panel;
  }

  function renderExtracting(): HTMLElement {
    const panel = el(
      'div',
      { class: 'panel panel-pad import-extracting' },
      el('div', { class: 'loading' }, 'extracting · matching lines against catalog ingredients'),
    );
    for (const w of SHIMMER_WIDTHS) {
      panel.appendChild(el('div', { class: 'shimmer', style: `width:${w}%` }));
    }
    panel.appendChild(
      button('btn btn-ghost', 'cancel', () => {
        token += 1;
        stage = 'paste';
        render();
      }),
    );
    return panel;
  }

  async function submit(): Promise<void> {
    if (!url.trim() && !text.trim()) {
      error = 'Enter a URL or paste recipe text.';
      render();
      return;
    }
    error = null;
    errorDetails = [];
    stage = 'extracting';
    render();
    const mine = ++token;
    try {
      const input = url.trim() ? { url: url.trim() } : { text: text.trim() };
      const res = await extractDraft(input);
      if (mine !== token) return; // cancelled or superseded
      draft = res.draft;
      truncated = res.truncated === true;
      stage = 'review';
      render();
    } catch (err) {
      if (mine !== token) return;
      error = userMessage(err);
      errorDetails = fieldErrors(err);
      stage = 'paste';
      render();
    }
  }

  return {
    title: 'Recipe import',
    subtitle: 'url or text → draft → review',
    mount(root, context) {
      rootEl = root;
      ctx = context;
      render();
    },
    unmount() {
      token += 1;
      teardownReview?.();
      teardownReview = null;
    },
  };
}
