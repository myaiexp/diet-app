// Today screen panel builders — stats, slots, spoiling.
//
// Every function here is a pure render: it takes already-loaded data (never
// fetches) and a handful of callbacks, and returns DOM.
//
// Recipe titles come from the screen's `recipesById`, built once from
// listAllRecipes() and formatted through entryTitle() so a recipe-backed
// entry shows its real title here too, not an id.

import type { Route } from '../../router.js';
import type { MealPlanEntry, PantryItem, Recipe, Slot } from '../../api/types.js';
import { SLOTS } from '../../api/types.js';
import { el, button } from '../../ui/dom.js';
import { formatQuantity, toNumber } from '../../format/quantity.js';
import { finnishWeekdayLong, finnishDate, daysUntil, daysRemainingLabel } from '../../format/date.js';
import { entryTitle, STATUS_LABEL, isCookable } from '../../format/entry.js';
import { rampColor, statusLabel, applyRamp } from '../../format/expiry.js';

const SPOIL_COUNT = 5;

// ===== Stat strip =====

function statCell(key: string, valueEl: HTMLElement, note: string): HTMLElement {
  return el(
    'div',
    { class: 'stat-cell' },
    el('span', { class: 'stat-key' }, key),
    valueEl,
    el('span', { class: 'stat-note' }, note),
  );
}

/** No backing endpoint yet — an explicit dash, never a fabricated number. */
function placeholderStat(key: string, note: string): HTMLElement {
  return statCell(key, el('span', { class: 'stat-value stat-placeholder' }, '—'), note);
}

function numberStat(key: string, value: number, note: string, color?: string): HTMLElement {
  const valueEl = el('span', { class: 'stat-value' }, String(value));
  if (color) valueEl.style.color = color;
  return statCell(key, valueEl, note);
}

export function buildStatStrip(pantryItems: PantryItem[]): HTMLElement {
  const useToday = pantryItems.filter((i) => i.status === 'use_today');
  const expired = pantryItems.filter((i) => i.status === 'expired');

  const useTodayNote = useToday.length
    ? useToday.slice(0, 2).map((i) => i.ingredient.name).join(' · ')
    : 'nothing urgent';
  const expiredNote = expired.length
    ? `${expired[0]!.ingredient.name} · ${daysRemainingLabel(daysUntil(expired[0]!.expiresDate))}`
    : 'none';

  return el(
    'div',
    { class: 'hairline-grid today-stat-strip' },
    placeholderStat('eaten', 'nutrition screen'),
    placeholderStat('protein', 'nutrition screen'),
    numberStat('use today', useToday.length, useTodayNote, useToday.length ? 'var(--orange)' : undefined),
    numberStat('expired', expired.length, expiredNote, expired.length ? 'var(--red)' : undefined),
    placeholderStat('to buy', 'shopping screen'),
  );
}

// ===== Today's slots =====

export interface SlotHandlers {
  onEmpty(date: string, slot: Slot): void;
  onCook(entry: MealPlanEntry): void;
  onRate(entry: MealPlanEntry): void;
}

function entryMeta(entry: MealPlanEntry): string {
  return `${toNumber(entry.servings)} serv`;
}

function buildFilledSlot(
  slot: Slot,
  entry: MealPlanEntry,
  rated: boolean,
  recipesById: Map<string, Recipe>,
  handlers: SlotHandlers,
): HTMLElement {
  const dimmed = entry.status === 'cooked' && rated;
  const status = STATUS_LABEL[entry.status];
  const row = el(
    'div',
    { class: `row today-slot-row${dimmed ? ' is-dimmed' : ''}` },
    el('span', { class: 'today-slot-name' }, slot),
    el(
      'div',
      { class: 'row-main' },
      el('div', { class: 'row-title text-pretty' }, entryTitle(entry, recipesById)),
      el('div', { class: 'row-meta' }, entryMeta(entry)),
    ),
    el('span', { class: status.cls }, status.text),
  );
  if (entry.status === 'cooked' && !rated) {
    row.appendChild(button('btn btn-sm', 'rate', () => handlers.onRate(entry)));
  } else if (isCookable(entry.status)) {
    // Substituted is still to-cook (shopping demand); skipped has no CTA —
    // un-skip from Plan. Plan itself reopens substituted for edit, never cook.
    row.appendChild(button('btn btn-primary btn-sm', 'cook →', () => handlers.onCook(entry)));
  }
  return row;
}

function buildEmptySlot(slot: Slot, date: string, handlers: SlotHandlers): HTMLElement {
  return el(
    'div',
    { class: 'row today-slot-row' },
    el('span', { class: 'today-slot-name' }, slot),
    el('div', { class: 'row-main' }, el('span', { class: 'today-slot-empty' }, 'empty')),
    button('btn btn-sm', 'fill', () => handlers.onEmpty(date, slot)),
  );
}

/** One row per slot in SLOTS order, each with the state-dependent action. */
export function buildSlotsPanel(
  dateIso: string,
  todaysEntries: MealPlanEntry[],
  ratedByEntryId: Map<string, boolean>,
  recipesById: Map<string, Recipe>,
  handlers: SlotHandlers,
): HTMLElement {
  const bySlot = new Map<Slot, MealPlanEntry>();
  for (const e of todaysEntries) bySlot.set(e.slot, e);

  const panel = el(
    'div',
    { class: 'panel today-slots' },
    el('div', { class: 'section-header' }, `today · ${finnishWeekdayLong(dateIso)} ${finnishDate(dateIso)}`),
  );
  for (const slot of SLOTS) {
    const entry = bySlot.get(slot);
    panel.appendChild(
      entry
        ? buildFilledSlot(slot, entry, ratedByEntryId.get(entry.id) === true, recipesById, handlers)
        : buildEmptySlot(slot, dateIso, handlers),
    );
  }
  return panel;
}

// ===== Spoiling panel =====

function buildSpoilingRow(item: PantryItem): HTMLElement {
  const alias = item.ingredient.aliases?.[0];
  const titleLine = el(
    'div',
    { class: 'today-spoil-title' },
    el('span', { class: 'row-title' }, item.ingredient.name),
    alias ? el('span', { class: 'today-spoil-alias' }, alias) : null,
  );
  const metaLine = el(
    'div',
    { class: 'row-meta' },
    `${formatQuantity(toNumber(item.quantity), item.unit)} · ${item.location}`,
  );
  const ramp = rampColor(item.status);
  const statusEl = el('span', { class: 'label today-spoil-status' }, statusLabel(item.status));
  statusEl.style.background = ramp.badge;
  statusEl.style.color = ramp.text;

  const row = el(
    'div',
    { class: 'row today-spoil-row' },
    el('div', { class: 'row-main' }, titleLine, metaLine),
    el('div', { class: 'row-right' }, statusEl),
  );
  applyRamp(row, item.status);
  return row;
}

/**
 * The five soonest-expiring items — `pantryItems` already arrives spoilage-
 * first with an id tie-break, so `.slice(0, 5)` is the whole job. Never sort.
 */
export function buildSpoilingPanel(pantryItems: PantryItem[], navigate: (r: Route) => void): HTMLElement {
  const soon = pantryItems.slice(0, SPOIL_COUNT);
  const panel = el('div', { class: 'panel today-spoiling' }, el('div', { class: 'section-header' }, 'spoiling'));

  if (soon.length === 0) {
    panel.appendChild(el('div', { class: 'empty-state' }, el('p', {}, 'Nothing tracked yet.')));
  } else {
    for (const item of soon) panel.appendChild(buildSpoilingRow(item));
  }

  // The mockup's "plan around these" points at AI suggestions, which doesn't
  // exist yet (#380) — a quick add-to-pantry action is the real, immediate
  // thing this panel can offer instead.
  panel.appendChild(
    el(
      'div',
      { class: 'today-spoiling-footer flex gap-2' },
      button('btn btn-primary btn-sm', '+ add to pantry', () => navigate('/pantry')),
      button('btn btn-ghost btn-sm', 'waste report', () => navigate('/waste')),
    ),
  );
  return panel;
}
