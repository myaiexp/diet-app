// Today screen: the "what now" action list and the first-run empty state.

import type { Route } from '../../router.js';
import type { MealPlanEntry, PantryItem, Recipe } from '../../api/types.js';
import { SLOTS } from '../../api/types.js';
import { el, button } from '../../ui/dom.js';
import { finnishWeekdayLong, addDays, isoToday } from '../../format/date.js';
import { entryTitle, isCookable } from '../../format/entry.js';

function whatNowRow(glyph: string, color: string, text: string, onClick: () => void): HTMLElement {
  const row = button('today-whatnow-row', '', onClick);
  const glyphEl = el('span', { class: 'today-whatnow-glyph' }, glyph);
  glyphEl.style.color = color;
  row.append(
    glyphEl,
    el('span', { class: 'today-whatnow-text text-pretty' }, text),
    el('span', { class: 'today-whatnow-arrow' }, '→'),
  );
  return row;
}

/**
 * Every row here is substantiated by `entries`/`pantryItems`/`recipesById`
 * alone. The recipe collection gives real titles, but not ingredient lines —
 * so a row can say "Cook tonight's Lohikeitto" but not the mockup's "...
 * clears 400 g salmon", which needs data this screen never loads. Naming the
 * title is the honest half of that sentence; fewer, true rows beat a
 * fabricated one.
 */
export function buildWhatNowPanel(
  entries: MealPlanEntry[],
  pantryItems: PantryItem[],
  monday: string,
  recipesById: Map<string, Recipe>,
  navigate: (r: Route) => void,
): HTMLElement {
  const todayIso = isoToday();
  const rows: HTMLElement[] = [];

  const dinner = entries.find((e) => e.date === todayIso && e.slot === 'dinner' && isCookable(e.status));
  if (dinner) {
    rows.push(
      whatNowRow(
        '◆',
        'var(--accent-text)',
        `Cook tonight's ${entryTitle(dinner, recipesById)}`,
        () => navigate('/plan'),
      ),
    );
  }

  const expired = pantryItems.filter((i) => i.status === 'expired');
  if (expired.length > 0) {
    rows.push(
      whatNowRow(
        '!',
        'var(--red)',
        `${expired.length} pantry item${expired.length === 1 ? '' : 's'} expired — clear them out`,
        () => navigate('/pantry'),
      ),
    );
  }

  const useToday = pantryItems.filter((i) => i.status === 'use_today');
  if (useToday.length > 0) {
    rows.push(
      whatNowRow(
        '!',
        'var(--orange)',
        `${useToday.length} item${useToday.length === 1 ? '' : 's'} expiring today — plan them into tonight`,
        () => navigate('/plan'),
      ),
    );
  }

  const openToday = SLOTS.length - entries.filter((e) => e.date === todayIso).length;
  if (openToday > 0) {
    rows.push(
      whatNowRow(
        '◆',
        'var(--accent-text)',
        `${openToday} slot${openToday === 1 ? '' : 's'} open today — fill ${openToday === 1 ? 'it' : 'them'}`,
        () => navigate('/plan'),
      ),
    );
  }

  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    if (date === todayIso) continue;
    if (entries.filter((e) => e.date === date).length === 0) {
      rows.push(
        whatNowRow('✳', 'var(--orange)', `${finnishWeekdayLong(date)} is empty — plan the week`, () => navigate('/plan')),
      );
      break;
    }
  }

  const panel = el('div', { class: 'panel today-whatnow' }, el('div', { class: 'section-header' }, 'what now'));
  if (rows.length === 0) {
    panel.appendChild(el('div', { class: 'today-whatnow-empty helper' }, 'Nothing urgent — plan and pantry are both on track.'));
  } else {
    for (const row of rows) panel.appendChild(row);
  }
  return panel;
}

/**
 * A fresh install has zero recipes and zero pantry items — the design's four
 * empty panels would be the actual first impression. One panel explaining the
 * loop, with the three buttons that start it, is the real landing experience.
 */
export function buildFirstRun(navigate: (r: Route) => void): HTMLElement {
  return el(
    'div',
    { class: 'empty-state today-first-run' },
    el('h1', {}, 'Nothing tracked yet'),
    el(
      'p',
      { class: 'text-pretty' },
      'Ruoka plans around what is actually in your kitchen: add what is in the fridge, ' +
        'write or import a recipe, then fill the week — cooking auto-deducts the pantry ' +
        'and asks for five seconds of feedback afterwards.',
    ),
    el(
      'div',
      { class: 'today-first-run-actions flex gap-2' },
      button('btn btn-primary', '1. add to pantry →', () => navigate('/pantry')),
      button('btn', '2. import a recipe →', () => navigate('/import')),
      button('btn btn-ghost', '3. plan the week →', () => navigate('/plan')),
    ),
  );
}
