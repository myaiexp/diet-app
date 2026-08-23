// Display formatting: quantities, Finnish dates, the expiry ramp, meal-plan entries

import { describe, test, expect } from 'vitest';
import { formatQuantity, formatNumber, toNumber } from '../format/quantity.js';
import { baseUnit } from '../format/units.js';
import {
  finnishWeekday,
  finnishWeekdayLong,
  finnishDate,
  daysRemainingLabel,
  daysUntil,
  mondayOf,
  addDays,
  isoWeekNumber,
} from '../format/date.js';
import { rampColor, statusLabel } from '../format/expiry.js';
import { entryTitle, STATUS_LABEL, isCookable } from '../format/entry.js';
import type { EntryStatus, MealPlanEntry, Recipe } from '../api/types.js';

describe('formatQuantity', () => {
  test('formats above 100 to the nearest 5', () => {
    expect(formatQuantity(402.5, 'g')).toBe('400 g');
    expect(formatQuantity(404, 'g')).toBe('405 g');
    expect(formatQuantity(1480, 'g')).toBe('1 480 g'); // space thousands separator
  });

  test('formats at or below 100 to one decimal with a comma', () => {
    expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg');
    expect(formatQuantity(20, 'g')).toBe('20 g'); // no trailing ,0
    expect(formatQuantity(0.25, 'l')).toBe('0,3 l');
  });

  test('formatNumber omits the unit', () => {
    expect(formatNumber(1480)).toBe('1 480');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  test('toNumber parses a numeric column safely', () => {
    expect(toNumber('400')).toBe(400);
    expect(toNumber(null)).toBe(0);
    expect(toNumber('not a number')).toBe(0);
  });
});

describe('baseUnit', () => {
  test('maps each dimension to the canonical storage unit', () => {
    expect(baseUnit('mass')).toBe('g');
    expect(baseUnit('volume')).toBe('ml');
    expect(baseUnit('count')).toBe('pieces');
  });
});

describe('dates', () => {
  test('names the weekday in Finnish', () => {
    expect(finnishWeekday('2026-08-04')).toBe('ti');
    expect(finnishWeekdayLong('2026-08-04')).toBe('tiistai');
    expect(finnishWeekday('2026-08-09')).toBe('su');
  });

  test('formats a short Finnish date', () => {
    expect(finnishDate('2026-08-04')).toBe('4.8.');
    expect(finnishDate('2026-12-31')).toBe('31.12.');
  });

  test('labels days remaining', () => {
    expect(daysRemainingLabel(-1)).toBe('1d ago');
    expect(daysRemainingLabel(0)).toBe('today');
    expect(daysRemainingLabel(1)).toBe('1 day');
    expect(daysRemainingLabel(3)).toBe('3 days');
    expect(daysRemainingLabel(59)).toBe('59 days');
    expect(daysRemainingLabel(90)).toBe('3 mo');
  });

  test('counts whole UTC days, matching the API status arithmetic', () => {
    const now = new Date('2026-08-04T21:30:00.000Z');
    expect(daysUntil('2026-08-04', now)).toBe(0);
    expect(daysUntil('2026-08-05', now)).toBe(1);
    expect(daysUntil('2026-08-03', now)).toBe(-1);
  });

  test('walks weeks for the plan toolbar', () => {
    expect(mondayOf('2026-08-04')).toBe('2026-08-03');
    expect(mondayOf('2026-08-09')).toBe('2026-08-03'); // Sunday closes the week
    expect(addDays('2026-08-03', 6)).toBe('2026-08-09');
    expect(isoWeekNumber('2026-08-04')).toBe(32);
  });
});

describe('expiry ramp', () => {
  test('maps every status to a ramp color', () => {
    expect(rampColor('use_soon').text).toBe('#e8a308'); // amber literal, not var(--accent)
    expect(rampColor('expired').text).toBe('var(--red)');
    expect(rampColor('use_today').text).toBe('var(--orange)');
    expect(rampColor('fresh').text).toBe('var(--green)');
  });

  test('tints only the two urgent rows', () => {
    expect(rampColor('expired').row).not.toBeNull();
    expect(rampColor('use_today').row).not.toBeNull();
    expect(rampColor('use_soon').row).toBeNull();
    expect(rampColor('fresh').row).toBeNull();
  });

  test('labels a status for the pill', () => {
    expect(statusLabel('use_today')).toBe('use today');
    expect(statusLabel('expired')).toBe('expired');
  });
});

function makeRecipe(id: string, title: string): Recipe {
  return {
    id,
    title,
    sourceType: 'manual',
    sourceUrl: null,
    parentRecipeId: null,
    steps: [],
    prepTime: null,
    totalTime: null,
    servings: 2,
    effortScore: null,
    tags: null,
    cuisineType: null,
    userRating: null,
    timesCooked: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeEntry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'e1',
    date: '2026-08-04',
    slot: 'dinner',
    recipeId: null,
    freeformNote: null,
    servings: '2',
    status: 'planned',
    substituteRecipeId: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('entryTitle', () => {
  const recipes = new Map<string, Recipe>([
    ['r-soup', makeRecipe('r-soup', 'Lohikeitto')],
    ['r-sub', makeRecipe('r-sub', 'Substitute Dish')],
  ]);

  test('resolves a recipe-backed entry from the collection', () => {
    expect(entryTitle(makeEntry({ recipeId: 'r-soup' }), recipes)).toBe('Lohikeitto');
  });

  test('substituteRecipeId wins over recipeId — that is the dish that gets cooked', () => {
    expect(
      entryTitle(makeEntry({ recipeId: 'r-soup', substituteRecipeId: 'r-sub' }), recipes),
    ).toBe('Substitute Dish');
  });

  test('falls back to (recipe) when the id is missing from the loaded collection', () => {
    expect(entryTitle(makeEntry({ recipeId: 'r-gone' }), recipes)).toBe('(recipe)');
  });

  test('appends notes to a recipe title, not to a freeform note', () => {
    expect(entryTitle(makeEntry({ recipeId: 'r-soup', notes: 'extra dill' }), recipes)).toBe(
      'Lohikeitto · extra dill',
    );
    expect(entryTitle(makeEntry({ freeformNote: 'Leftovers', notes: 'extra dill' }), recipes)).toBe(
      'Leftovers',
    );
  });

  test('uses the freeform note when there is no recipe, else (untitled)', () => {
    expect(entryTitle(makeEntry({ freeformNote: 'Leftovers' }), recipes)).toBe('Leftovers');
    expect(entryTitle(makeEntry(), recipes)).toBe('(untitled)');
  });

  test('a recipeId beats a freeform note on the same entry', () => {
    expect(entryTitle(makeEntry({ recipeId: 'r-soup', freeformNote: 'Leftovers' }), recipes)).toBe(
      'Lohikeitto',
    );
  });
});

describe('STATUS_LABEL', () => {
  test('covers every EntryStatus with a visible label and the matching pill class', () => {
    const expected: Record<EntryStatus, { text: string; cls: string }> = {
      planned: { text: 'planned', cls: 'label' },
      cooked: { text: 'cooked', cls: 'label label-green' },
      skipped: { text: 'skipped', cls: 'label label-red' },
      substituted: { text: 'substituted', cls: 'label label-orange' },
    };
    expect(STATUS_LABEL).toEqual(expected);
  });
});

describe('isCookable', () => {
  test('planned and substituted still need a cook; cooked and skipped do not', () => {
    expect(isCookable('planned')).toBe(true);
    expect(isCookable('substituted')).toBe(true);
    expect(isCookable('cooked')).toBe(false);
    expect(isCookable('skipped')).toBe(false);
  });
});
