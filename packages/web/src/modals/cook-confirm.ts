// Cook confirm modal — preview-then-commit, irreversibility surfaced before the click.
//
// The deduction table always comes from GET .../cook-preview (FEFO: soonest expiry,
// then opened-before-unopened, then oldest createdAt — computed server-side, never
// re-derived here). Ingredient names and lot dates aren't on the preview response, so
// they're resolved once per modal open from getRecipe() and listAllPantry(), not per row.
// Either fetch failing still shows cook-preview amounts, a degraded warning, and a
// live commit — POST /cook re-plans server-side, so missing names/dates are display-only.

import '../css/cook.css';
import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';
import { el, button, loadingRow } from '../ui/dom.js';
import { loadInto } from '../ui/async.js';
import { formatQuantity, toNumber } from '../format/quantity.js';
import { baseUnit } from '../format/units.js';
import { finnishDate, finnishWeekday, daysUntil } from '../format/date.js';
import { previewCook, cook, patchEntry } from '../api/meal-plans.js';
import { getRecipe } from '../api/recipes.js';
import { listAllPantry } from '../api/pantry.js';
import { isApiError, userMessage } from '../api/errors.js';
import type {
  MealPlanEntry,
  CookPreview,
  CookResult,
  Deduction,
  Shortfall,
  PantryItem,
} from '../api/types.js';

export interface CookConfirmOptions {
  entry: MealPlanEntry;
  /** A cook committed successfully. */
  onCooked: (result: CookResult) => void;
  /** cook() 409'd — someone else cooked this entry first. */
  onAlreadyCooked: () => void;
  /** mark skipped PATCHed successfully — not a cook, no feedback. */
  onSkipped: (entry: MealPlanEntry) => void;
}

export const DEBOUNCE_MS = 150;

/** How urgent the lot is — the second half of the provenance line. */
function expiryLabel(expiresDate: string): string {
  const days = daysUntil(expiresDate);
  if (days < 0) return `EXPIRED ${Math.abs(days)}d`;
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires in 1 day';
  return `expires in ${days} days`;
}

function nameOf(map: Map<string, string>, ingredientId: string): string {
  return map.get(ingredientId) ?? ingredientId;
}

function shortfallText(s: Shortfall, name: string): string {
  if (s.reason === 'not_in_pantry') return `${name} — not in pantry — buy first`;
  if (s.reason === 'unit_mismatch') {
    return `${name} — units don't convert (mass/volume/count only)`;
  }
  const unit = s.dimension ? baseUnit(s.dimension) : '';
  return `${name} — short ${formatQuantity(s.requested - s.available, unit)}`;
}

function renderDeduction(
  d: Deduction,
  name: string,
  pantryById: Map<string, PantryItem>,
): HTMLElement {
  const lots = d.pantryItems.map((p) => {
    const item = pantryById.get(p.id);
    const before = toNumber(p.before);
    const after = toNumber(p.after);
    // A lot is identified by when it came in, not when it goes off: the
    // design's own "lot 2.8. · expires today" only reads as one thing if the
    // two dates are different, and two lots of the same ingredient are told
    // apart by their purchase date.
    const provenance = item
      ? `lot ${finnishDate(item.addedDate)} · ${expiryLabel(item.expiresDate)}${item.opened ? ' · opened' : ''}`
      : 'lot ?';
    return el(
      'div',
      { class: 'cook-lot-row' },
      el('span', { class: 'cook-lot-info' }, provenance),
      el('span', { class: 'cook-lot-amount' }, `−${formatQuantity(before - after, p.unit)}`),
      el('span', { class: 'cook-lot-left' }, `${formatQuantity(after, p.unit)} left`),
    );
  });
  return el('div', { class: 'cook-item' }, el('div', { class: 'cook-item-name' }, name), ...lots);
}

export function openCookConfirm(opts: CookConfirmOptions): void {
  const { entry } = opts;
  const resolvedRecipeId = entry.substituteRecipeId ?? entry.recipeId;
  const initialServings = toNumber(entry.servings) || 1;
  let servings = initialServings;
  let nameById = new Map<string, string>();
  let pantryById = new Map<string, PantryItem>();
  let pantryFailed = false;
  let recipeFailed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let previewGen = 0;

  const tableEl = el('div', { class: 'cook-table' }, loadingRow('loading preview…'));
  const degradedEl = el('div', { class: 'cook-degraded hidden' });
  const warningEl = el('div', { class: 'cook-warning' });
  const stepValue = el('span', { class: 'cook-step-value' }, String(servings));
  const stepRow = el(
    'div',
    { class: 'cook-stepper' },
    button('btn btn-sm cook-step-minus', '−', () => changeServings(-1)),
    stepValue,
    button('btn btn-sm cook-step-plus', '+', () => changeServings(1)),
    el('span', { class: 'helper cook-step-note' }, 'quantities above rescale live'),
  );

  const body = el(
    'div',
    {},
    degradedEl,
    el('div', { class: 'section-header' }, 'will be deducted · oldest expiry first'),
    tableEl,
    warningEl,
    stepRow,
  );

  const cancelBtn = button('btn btn-ghost cook-cancel', 'cancel', () => closeModal());
  const skipBtn = button('btn cook-skip', 'mark skipped', () => void handleSkip());
  const commitBtn = button('btn btn-primary cook-commit', 'deduct & mark cooked', () =>
    void handleCommit(),
  );
  const footer = el('div', {}, cancelBtn, skipBtn, commitBtn);

  const handle = openModal({
    title: 'Cook',
    meta: metaText(),
    body,
    footer,
    width: 520,
    // Escape/backdrop/navigate must cancel the servings debounce: a late
    // loadPreview would fetch against a closed modal (detached tableEl) and
    // can 409 if another tab already cooked the entry.
    onClose: abortPreview,
  });

  function metaText(): string {
    return `${finnishWeekday(entry.date)} ${finnishDate(entry.date)} · ${entry.slot} · ${servings} servings`;
  }

  function updateMeta(): void {
    const metaEl = handle.frame.querySelector('.modal-meta');
    if (metaEl) metaEl.textContent = metaText();
  }

  function updateTitle(title: string): void {
    const titleEl = handle.frame.querySelector('.modal-title');
    if (titleEl) titleEl.textContent = title;
  }

  function updateWarning(): void {
    warningEl.textContent =
      `! Marking cooked is final. The deduction above is computed from ${servings} ` +
      'servings and the entry locks — to change servings or recipe, do it now.';
  }

  function updateDegraded(): void {
    const parts = [
      pantryFailed &&
        "Couldn't load pantry lots — dates shown as ?. Amounts below are still from the cook preview.",
      recipeFailed && "Couldn't load recipe — ingredients shown as ids.",
    ].filter((s): s is string => typeof s === 'string');
    degradedEl.textContent = parts.join(' ');
    degradedEl.classList.toggle('hidden', parts.length === 0);
  }

  function setBusy(next: boolean): void {
    busy = next;
    cancelBtn.disabled = next;
    skipBtn.disabled = next;
    commitBtn.disabled = next;
  }

  function abortPreview(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    previewGen++;
  }

  function changeServings(delta: number): void {
    // Same 1–12 clamp as the recipe detail scaler — one servings vocabulary.
    servings = Math.min(12, Math.max(1, servings + delta));
    stepValue.textContent = String(servings);
    updateMeta();
    updateWarning();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void loadPreview(), DEBOUNCE_MS);
  }

  function renderPreview(preview: CookPreview): void {
    tableEl.replaceChildren();
    if (preview.deductions.length === 0 && preview.shortfalls.length === 0) {
      tableEl.appendChild(el('div', { class: 'cook-empty' }, 'nothing to deduct'));
      return;
    }
    for (const d of preview.deductions) {
      tableEl.appendChild(renderDeduction(d, nameOf(nameById, d.ingredientId), pantryById));
    }
    for (const s of preview.shortfalls) {
      tableEl.appendChild(
        el('div', { class: 'cook-item-shortfall' }, shortfallText(s, nameOf(nameById, s.ingredientId))),
      );
    }
  }

  async function loadPreview(): Promise<void> {
    const gen = ++previewGen;
    await loadInto({
      container: tableEl,
      label: 'loading preview…',
      isStale: () => gen !== previewGen,
      load: () => previewCook(entry.id, servings),
      render: renderPreview,
    });
  }

  async function init(): Promise<void> {
    updateWarning();
    const pantryLoad = listAllPantry()
      .then((rows) => {
        pantryById = new Map(rows.map((r) => [r.id, r]));
      })
      .catch(() => {
        pantryFailed = true;
      });
    const recipeLoad = resolvedRecipeId
      ? getRecipe(resolvedRecipeId)
          .then((recipe) => {
            nameById = new Map(
              recipe.recipeIngredients.map((line) => [
                line.ingredientId,
                line.ingredient?.name ?? line.ingredientId,
              ]),
            );
            updateTitle(`Cook · ${recipe.title}`);
          })
          .catch(() => {
            recipeFailed = true;
          })
      : Promise.resolve().then(() => {
          updateTitle(entry.freeformNote ? `Cook · ${entry.freeformNote}` : 'Cook');
        });
    await Promise.all([pantryLoad, recipeLoad]);
    updateDegraded();
    await loadPreview();
  }

  async function handleSkip(): Promise<void> {
    if (busy) return;
    setBusy(true);
    previewGen++;
    try {
      const updated = await patchEntry(entry.id, { status: 'skipped' });
      closeModal();
      say('Marked skipped.');
      opts.onSkipped(updated);
    } catch (err) {
      say(userMessage(err), 'error');
      setBusy(false);
    }
  }

  async function handleCommit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    previewGen++;
    try {
      // One request, one outcome. The stepper says what is actually being
      // cooked; the entry's planned `servings` is left as the record of intent,
      // so a failed cook can't leave the entry re-planned but uncooked.
      const result = await cook(entry.id, servings);
      closeModal();
      opts.onCooked(result);
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        closeModal();
        opts.onAlreadyCooked();
        return;
      }
      say(userMessage(err), 'error');
      setBusy(false);
    }
  }

  void init();
}
