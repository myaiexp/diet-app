// Recipe detail pane: header, stat strip, servings scaler, ingredients/steps,
// footer actions, the edit modal and the fork action.
//
// Scaling is server-side only (getRecipe(id, servings)): reimplementing
// qty * target / base here would create a second rounding path that disagrees
// with the deduction the cook flow applies. Editing always refetches the
// unscaled recipe first, so a save while scaled can never persist scaled
// quantities as the new base.

import { getRecipe, patchRecipe, forkRecipe } from '../../api/recipes.js';
import type {
  Recipe, RecipeWithIngredients, RecipeIngredientLine, RecipeLineInput, RecipePatch, PantryItem, SourceType,
} from '../../api/types.js';
import { el, button, errorPanel } from '../../ui/dom.js';
import { loadInto } from '../../ui/async.js';
import { field, textInput } from '../../ui/form.js';
import { userMessage, fieldErrors } from '../../api/errors.js';
import { say } from '../../ui/toast.js';
import { openModal, closeModal } from '../../ui/modal.js';
import { formatQuantity, toNumber } from '../../format/quantity.js';

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 12;
const DEBOUNCE_MS = 150;

const SOURCE_LABEL: Record<SourceType, { text: string; cls: string }> = {
  manual: { text: 'manual', cls: 'label' },
  imported: { text: 'imported', cls: 'label label-blue' },
  ai: { text: 'ai', cls: 'label label-purple' },
  forked: { text: 'forked', cls: 'label label-cyan' },
};

export interface DetailDeps {
  /** Indexed once per screen mount — never refetched per ingredient line. */
  pantryById: Map<string, PantryItem>;
  /** A fork is a new recipe; the caller refreshes the list and selects it. */
  onForked(created: Recipe): void;
}

export interface DetailHandle {
  show(id: string): Promise<void>;
  showEmpty(message: string): void;
  destroy(): void;
}

function clamp(n: number): number {
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n));
}

/** '1.5' not '1,5' — a debug-style note, not a display quantity. */
function factorLabel(f: number): string {
  return Number.isInteger(f) ? String(f) : f.toFixed(1);
}

/** Only the API's `status` decides this — never recomputed from a date. */
function pantryLabel(
  pantryById: Map<string, PantryItem>,
  ingredientId: string,
): { text: string; cls: string } {
  const item = pantryById.get(ingredientId);
  if (!item) return { text: 'to buy', cls: 'label label-tobuy' };
  if (item.status === 'expired') return { text: 'expired', cls: 'label label-red' };
  return { text: 'in pantry', cls: 'label label-green' };
}

function ingredientRow(line: RecipeIngredientLine, pantryById: Map<string, PantryItem>): HTMLElement {
  const p = pantryLabel(pantryById, line.ingredientId);
  const name = el(
    'span',
    { class: 'ingredient-name' },
    line.ingredient?.name ?? line.ingredientId,
    line.notes ? el('span', { class: 'ingredient-note' }, ` ${line.notes}`) : null,
  );
  return el(
    'div',
    { class: 'ingredient-line' },
    el('span', { class: 'ingredient-qty' }, formatQuantity(toNumber(line.quantity), line.unit)),
    name,
    line.optional ? el('span', { class: 'label label-muted' }, 'optional') : null,
    el('span', { class: p.cls }, p.text),
  );
}

function stepRow(step: string, i: number): HTMLElement {
  return el('div', { class: 'step-line' }, el('span', { class: 'step-index' }, `${i + 1}.`), el('span', { class: 'text-pretty' }, step));
}

export function createRecipeDetail(container: HTMLElement, deps: DetailDeps): DetailHandle {
  let currentId: string | null = null;
  let detail: RecipeWithIngredients | null = null;
  let servings = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let token = 0;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function show(id: string): Promise<void> {
    clearTimer();
    currentId = id;
    const myToken = ++token;
    await loadInto({
      container,
      label: 'loading recipe…',
      isStale: () => myToken !== token,
      load: () => getRecipe(id),
      render: (data) => {
        detail = data;
        servings = data.servings;
        render();
      },
    });
  }

  function showEmpty(message: string): void {
    clearTimer();
    currentId = null;
    detail = null;
    ++token;
    container.replaceChildren(el('p', { class: 'helper' }, message));
  }

  function rescale(next: number): void {
    if (!currentId || next === servings) return;
    servings = next;
    // Value/note update now; quantities catch up once the debounced fetch
    // resolves — never computed client-side in between.
    render();
    clearTimer();
    const id = currentId;
    const myToken = token;
    timer = setTimeout(() => {
      timer = null;
      void getRecipe(id, next).then(
        (data) => {
          if (myToken !== token || id !== currentId) return;
          detail = data;
          render();
        },
        (err: unknown) => {
          if (myToken !== token || id !== currentId) return;
          say(userMessage(err), 'error');
        },
      );
    }, DEBOUNCE_MS);
  }

  async function handleFork(): Promise<void> {
    if (!detail) return;
    try {
      // forkRecipe un-scales the lines itself, even from a scaled `detail`.
      const created = await forkRecipe(detail);
      say(`Forked as "${created.title}".`);
      deps.onForked(created);
    } catch (err) {
      say(userMessage(err), 'error');
    }
  }

  async function openEditModal(): Promise<void> {
    if (!currentId) return;
    const id = currentId;
    let base: RecipeWithIngredients;
    try {
      // Never edit from a scaled view: refetch the true, unscaled recipe.
      base = await getRecipe(id);
    } catch (err) {
      say(userMessage(err), 'error');
      return;
    }
    renderEditForm(id, base);
  }

  function renderEditForm(id: string, base: RecipeWithIngredients): void {
    const lines = base.recipeIngredients.map((line) => ({
      ingredientId: line.ingredientId,
      optional: line.optional ?? false,
      notes: line.notes,
      name: line.ingredient?.name ?? line.ingredientId,
      qty: textInput(line.quantity, { class: 'edit-qty-input', type: 'number', step: 'any' }),
      unit: textInput(line.unit, { class: 'edit-unit-input' }),
      removed: false,
    }));
    const title = textInput(base.title);
    const servingsInput = textInput(base.servings, { type: 'number', min: '1' });
    const cuisine = textInput(base.cuisineType ?? '');
    const tags = textInput((base.tags ?? []).join(', '));
    const steps = el('textarea', { class: 'textarea' }) as HTMLTextAreaElement; // value is child text, not an attribute
    steps.value = base.steps.join('\n');

    const linesBox = el('div', { class: 'edit-lines' });
    for (const line of lines) {
      const row = el('div', { class: 'edit-ingredient-row' }, el('span', { class: 'edit-ingredient-name' }, line.name), line.qty, line.unit,
        button('btn btn-ghost btn-sm', 'remove', () => { line.removed = true; row.remove(); }));
      linesBox.appendChild(row);
    }
    const saveErr = el('div', {});
    const body = el('div', { class: 'flex flex-col gap-3' },
      field('title', title, { as: 'label' }),
      el('div', { class: 'flex gap-3' }, field('servings', servingsInput, { as: 'label' }), field('cuisine', cuisine, { as: 'label' })),
      field('tags (comma-separated)', tags, { as: 'label' }),
      field('steps (one per line)', steps, { as: 'label' }),
      el('div', { class: 'section-header' }, 'ingredients'),
      linesBox, saveErr);

    async function submit(): Promise<void> {
      // Wholesale replace: every remaining line goes, not just edited ones.
      const ingredients: RecipeLineInput[] = lines.filter((l) => !l.removed).map((l) => ({
        ingredientId: l.ingredientId, quantity: Number(l.qty.value), unit: l.unit.value, optional: l.optional, notes: l.notes,
      }));
      const patch: RecipePatch = {
        title: title.value.trim(),
        servings: Number(servingsInput.value),
        cuisineType: cuisine.value.trim() || null,
        tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
        steps: steps.value.split('\n').map((s) => s.trim()).filter(Boolean),
        ingredients,
      };
      try {
        const updated = await patchRecipe(id, patch);
        closeModal();
        say('Recipe saved.');
        detail = updated;
        servings = updated.servings;
        render();
      } catch (err) {
        saveErr.replaceChildren(errorPanel([userMessage(err), ...fieldErrors(err)].join(' ')));
      }
    }

    const footer = el('div', { class: 'flex gap-2' }, button('btn btn-ghost', 'cancel', () => closeModal()), button('btn btn-primary', 'save', () => void submit()));
    openModal({ title: `Edit ${base.title}`, body, footer, width: 560 });
  }

  function render(): void {
    if (!detail) return;
    const d = detail;
    const base = d.baseServings ?? d.servings;
    const src = SOURCE_LABEL[d.sourceType];
    const subParts = [d.cuisineType, ...(d.tags ?? []), `base recipe ${base} servings`].filter((p): p is string => Boolean(p));
    const stats: Array<[string, string]> = [
      ['prep', d.prepTime !== null ? `${d.prepTime} min` : '—'],
      ['total', d.totalTime !== null ? `${d.totalTime} min` : '—'],
      ['effort', d.effortScore !== null ? `${d.effortScore}/5` : '—'],
      ['cooked', `${d.timesCooked}×`],
      ['rating', d.userRating !== null ? `★${d.userRating}` : '—'],
    ];
    const note = servings === base ? 'base recipe' : `scaled ×${factorLabel(servings / base)} from ${base}`;

    const header = el('div', { class: 'recipe-detail-header' }, el('h1', {}, d.title), el('span', { class: `${src.cls} source-label` }, src.text));
    const statStrip = el('div', { class: 'hairline-grid recipe-stat-strip' },
      ...stats.map(([key, value]) => el('div', { class: 'stat-cell' }, el('span', { class: 'stat-key' }, key), el('span', { class: 'stat-value' }, value))));
    const scaler = el('div', { class: 'scaler' },
      el('span', { class: 'scaler-label' }, 'servings'),
      el('div', { class: 'scaler-controls' },
        button('btn scaler-btn scaler-minus', '−', () => rescale(clamp(servings - 1))),
        el('span', { class: 'scaler-value' }, String(servings)),
        button('btn scaler-btn scaler-plus', '+', () => rescale(clamp(servings + 1)))),
      el('span', { class: 'scaler-note' }, note));
    const ingredientsCol = el('div', { class: 'recipe-ingredients' }, el('div', { class: 'section-header' }, 'ingredients'),
      ...d.recipeIngredients.map((line) => ingredientRow(line, deps.pantryById)));
    const stepsCol = el('div', { class: 'recipe-steps' }, el('div', { class: 'section-header' }, 'steps'), ...d.steps.map(stepRow));
    // Follow-ups: add-to-plan/cook-now have no home yet — the meal-plan
    // screen and cook modal are being built concurrently elsewhere.
    const footer = el('div', { class: 'recipe-footer' },
      button('btn btn-primary add-to-plan-btn', 'add to plan', () => say('Add it from the meal plan grid.')),
      button('btn cook-now-btn', 'cook now', () => say('Cook it from a planned meal-plan entry.')),
      button('btn btn-ghost fork-btn', 'fork', () => void handleFork()),
      button('btn btn-ghost edit-btn', 'edit', () => void openEditModal()));

    container.replaceChildren(header, el('p', { class: 'recipe-subline' }, subParts.join(' · ')), statStrip, scaler,
      el('div', { class: 'recipe-body' }, ingredientsCol, stepsCol), footer);
  }

  return {
    show,
    showEmpty,
    destroy() {
      clearTimer();
      ++token;
    },
  };
}
