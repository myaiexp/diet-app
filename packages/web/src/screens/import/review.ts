// The reconciliation pane: draft fields + per-line ingredient binding.

import type { ScreenContext } from '../../router.js';
import { el, button } from '../../ui/dom.js';
import { field, textInput, errorBox, showError, hideError } from '../../ui/form.js';
import { attachIngredientSearch } from '../../ui/ingredient-picker.js';
import { say } from '../../ui/toast.js';
import { confirmRecipe } from '../../api/recipe-import.js';
import { userMessage, fieldErrors } from '../../api/errors.js';
import type {
  RecipeDraft,
  DraftIngredientLine,
  RecipeCreate,
  RecipeLineInput,
  MatchKind,
} from '../../api/types.js';

export type LineState = 'bound' | 'assumed' | 'unresolved';

export interface EditableLine {
  raw: string;
  ingredientId: string | null;
  /** Catalog name for `ingredientId`, so a bound row names its match. */
  ingredientName: string | null;
  quantity: number | null;
  unit: string;
  optional: boolean;
  notes: string | null;
  match: MatchKind;
  quantityInferred: boolean;
  query: string;
}

interface DraftMeta {
  title: string;
  sourceUrl: string | null;
  steps: string;
  servings: number;
  prepTime: number | null;
  totalTime: number | null;
  effortScore: number | null;
  cuisineType: string | null;
  tags: string[];
}

/**
 * `unresolved` = no catalog binding, or a cleared quantity — blocks saving.
 * `assumed` = matched, but the model invented the quantity. Never inferred
 * from the number's shape: `match` and `quantityInferred` are the only
 * sources of truth.
 */
export function classify(line: EditableLine): LineState {
  if (line.match === 'none' || !line.ingredientId || line.quantity === null) return 'unresolved';
  return line.quantityInferred ? 'assumed' : 'bound';
}

/**
 * Names the catalog row a line bound to. The generic fallback only shows for a
 * bound line whose name never arrived (an older draft response) — a reviewer
 * who cannot see the match cannot review it.
 */
function bindLabel(line: EditableLine): string {
  if (!line.ingredientId) return '→ no catalog match';
  return line.ingredientName ? `→ ${line.ingredientName}` : '→ catalog match';
}

function tally(lines: EditableLine[]): Record<LineState, number> {
  const counts: Record<LineState, number> = { bound: 0, assumed: 0, unresolved: 0 };
  for (const line of lines) counts[classify(line)] += 1;
  return counts;
}

function toEditable(l: DraftIngredientLine): EditableLine {
  return {
    raw: l.rawName, ingredientId: l.ingredientId, ingredientName: l.ingredientName,
    quantity: l.quantity, unit: l.unit,
    optional: l.optional, notes: l.notes, match: l.match, quantityInferred: l.quantityInferred,
    query: l.rawName,
  };
}

function toMeta(d: RecipeDraft): DraftMeta {
  return {
    title: d.title, sourceUrl: d.sourceUrl, steps: d.steps.join('\n'), servings: d.servings,
    prepTime: d.prepTime, totalTime: d.totalTime, effortScore: d.effortScore,
    cuisineType: d.cuisineType, tags: d.tags,
  };
}

function importField(labelText: string, control: HTMLElement): HTMLElement {
  return field(labelText, control, { as: 'label', class: 'import-field' });
}

function numberField(labelText: string, value: number | null, onChange: (v: number | null) => void) {
  return importField(
    labelText,
    textInput(value ?? '', { type: 'number' }, (v) => onChange(v.trim() === '' ? null : Number(v))),
  );
}

function buildFields(meta: DraftMeta, notify: () => void): HTMLElement {
  const title = el('input', { class: 'input', value: meta.title });
  title.addEventListener('change', () => { meta.title = title.value; notify(); });
  const cuisine = el('input', { class: 'input', value: meta.cuisineType ?? '' });
  cuisine.addEventListener('change', () => (meta.cuisineType = cuisine.value.trim() || null));
  const stepCount = meta.steps.split('\n').filter((s) => s.trim()).length;
  const steps = el('textarea', { class: 'textarea import-steps', rows: 6 }, meta.steps);
  steps.addEventListener('change', () => (meta.steps = steps.value));

  return el(
    'div',
    { class: 'panel panel-pad import-fields' },
    el('div', { class: 'section-header' }, 'draft'),
    importField('title', title),
    el('div', { class: 'flex gap-2 import-fields-row' },
      numberField('prep min', meta.prepTime, (v) => (meta.prepTime = v)),
      numberField('total min', meta.totalTime, (v) => (meta.totalTime = v)),
      numberField('servings', meta.servings, (v) => (meta.servings = v ?? meta.servings))),
    el('div', { class: 'flex gap-2 import-fields-row' },
      importField('cuisine', cuisine),
      numberField('effort 1-5', meta.effortScore, (v) => (meta.effortScore = v))),
    importField(`steps (${stepCount} extracted)`, steps),
  );
}

/** Mounts the full review pane (fields + reconciliation) into `root`. */
export function mountReview(root: HTMLElement, ctx: ScreenContext, draft: RecipeDraft): () => void {
  const meta = toMeta(draft);
  const lines: EditableLine[] = draft.ingredients.map(toEditable);
  const candidateUi = new Map<EditableLine, { node: HTMLElement; detach: () => void }>();
  let saving = false;

  const head = el('div', { class: 'import-lines-head' });
  const list = el('div', { class: 'import-line-list' });
  const saveBtn = button('btn btn-primary', 'save recipe', () => void doSave());
  const saveHelp = errorBox();

  root.appendChild(
    el('div', { class: 'import-review' },
      buildFields(meta, renderFooter),
      el('div', { class: 'panel panel-pad import-lines' }, head, list,
        el('div', { class: 'import-footer' }, saveBtn, saveHelp))),
  );

  const savable = (): EditableLine[] => lines.filter((l) => classify(l) !== 'unresolved');

  function problems(): string[] {
    const unresolved = lines.length - savable().length;
    if (unresolved > 0) {
      return [`${unresolved} unresolved line${unresolved === 1 ? '' : 's'} block saving — resolve or skip them.`];
    }
    if (savable().length === 0) return ['Every line was skipped — add at least one ingredient to save.'];
    if (!meta.title.trim()) return ['Title is required.'];
    return [];
  }

  /** Recomputes the three-state tally and the save gate — one pass. */
  function renderFooter(): void {
    const counts = tally(lines);
    head.replaceChildren(
      el('span', { class: 'section-header' }, 'ingredient reconciliation'),
      el('span', { class: 'label label-green' }, `${counts.bound} bound`),
      el('span', { class: 'label label-orange' }, `${counts.assumed} assumed`),
      el('span', { class: 'label label-red' }, `${counts.unresolved} need you`),
    );
    const msgs = saving ? [] : problems();
    saveBtn.disabled = saving || msgs.length > 0;
    if (msgs.length) showError(saveHelp, msgs[0]!);
    else hideError(saveHelp);
  }

  function discardCandidates(line: EditableLine): void {
    const ui = candidateUi.get(line);
    if (!ui) return;
    ui.detach();
    candidateUi.delete(line);
  }

  function candidatesFor(line: EditableLine): HTMLElement {
    const existing = candidateUi.get(line);
    if (existing) return existing.node;
    const ui = buildCandidates(line);
    candidateUi.set(line, ui);
    return ui.node;
  }

  function renderAll(): void {
    const live = new Set(lines);
    for (const line of [...candidateUi.keys()]) {
      const needs = live.has(line) && classify(line) === 'unresolved' && !line.ingredientId;
      if (!needs) discardCandidates(line);
    }
    list.replaceChildren(...lines.map((line, i) => buildRow(line, i)));
    renderFooter();
  }

  function buildRow(line: EditableLine, index: number): HTMLElement {
    const state = classify(line);
    const tint = state === 'bound' ? 'green' : state === 'assumed' ? 'orange' : 'red';

    const qty = textInput(
      line.quantity === null ? '' : String(line.quantity),
      { class: 'import-qty', 'aria-label': `quantity for ${line.raw}` },
      (v) => {
        const n = v.trim() === '' ? NaN : Number(v);
        line.quantity = v.trim() === '' || Number.isNaN(n) ? null : n;
        line.quantityInferred = false; // the user has now stated the amount
        renderAll();
      },
    );
    const unit = textInput(
      line.unit,
      { class: 'import-unit', 'aria-label': `unit for ${line.raw}` },
      (v) => { line.unit = v.trim(); },
    );

    const row = el(
      'div', { class: `import-line import-line--${state}` },
      el('div', { class: 'import-line-head' },
        el('span', { class: 'import-line-index' }, `${index + 1}.`),
        el('span', { class: 'import-line-raw' }, line.raw),
        el('span', { class: `label label-${tint}` }, state)),
      el('div', { class: 'import-line-bind' },
        el('span', { class: 'label-muted' }, bindLabel(line)),
        qty, unit),
    );

    if (state === 'unresolved' && !line.ingredientId) row.appendChild(candidatesFor(line));
    else if (state === 'unresolved') {
      row.appendChild(el('p', { class: 'helper-error' }, 'enter a quantity to resolve this line'));
    } else if (state === 'assumed') {
      row.appendChild(el('p', { class: 'helper' }, 'quantity assumed by the model — edit it to confirm'));
    }
    return row;
  }

  function buildCandidates(line: EditableLine): { node: HTMLElement; detach: () => void } {
    const results = el('div', { class: 'import-candidate-results' });
    const query = el('input', { class: 'input', value: line.query });
    query.addEventListener('input', () => { line.query = query.value; });
    const detach = attachIngredientSearch(query, results, (ing) => {
      line.ingredientId = ing.id;
      line.ingredientName = ing.name;
      line.match = 'exact';
      renderAll();
    }, {
      immediate: true,
      limit: 20,
      searchingText: 'searching…',
      emptyText: 'no catalog matches',
      renderResult: (ing, pick) => button('btn btn-sm', ing.name, pick),
    });

    const node = el(
      'div', { class: 'import-candidates' },
      el('p', { class: 'helper' }, 'closest catalog matches — pick one, or add it'),
      query, results,
      button('btn btn-primary', `create "${line.raw}"`, () => {}, { disabled: true }),
      el('p', { class: 'helper' }, "new catalog ingredients aren't creatable yet"),
      button('btn btn-ghost', 'skip line', () => {
        const at = lines.indexOf(line);
        if (at >= 0) lines.splice(at, 1);
        renderAll();
      }),
    );
    return { node, detach };
  }

  async function doSave(): Promise<void> {
    saving = true;
    renderFooter();
    const ingredients: RecipeLineInput[] = savable().map((line) => ({
      ingredientId: line.ingredientId!, quantity: line.quantity!, unit: line.unit,
      optional: line.optional, notes: line.notes,
    }));
    const body: RecipeCreate = {
      title: meta.title.trim(), sourceType: draft.sourceType, sourceUrl: meta.sourceUrl,
      steps: meta.steps.split('\n').map((s) => s.trim()).filter(Boolean),
      servings: meta.servings, cuisineType: meta.cuisineType, tags: meta.tags, ingredients,
      prepTime: meta.prepTime ?? undefined, totalTime: meta.totalTime ?? undefined,
      effortScore: meta.effortScore ?? undefined,
    };
    try {
      await confirmRecipe(body);
      say('Recipe saved.', 'success');
      ctx.navigate('/recipes');
    } catch (err) {
      saving = false;
      showError(saveHelp, userMessage(err), fieldErrors(err));
      saveBtn.disabled = false;
    }
  }

  renderAll();

  return () => {
    for (const line of [...candidateUi.keys()]) discardCandidates(line);
  };
}
