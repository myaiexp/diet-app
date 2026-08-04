// Postgres-free unit tests for the demo seed's pure helpers: ingredient
// matching, the db-name safety guard, and date math relative to a given
// "today" (never the wall clock, so the test stays deterministic).
//
// Written as .mjs (not .ts) to import scripts/seed-demo.mjs directly without
// fighting TypeScript's module resolution for a plain .mjs file — vitest picks
// up .test.mjs the same as .test.ts.

import { describe, test, expect } from 'vitest';
import {
  matchIngredient,
  resolveDbName,
  isGuardedDbName,
  relativeDate,
  mondayOfIsoWeek,
  buildPantryRows,
  buildRecipes,
  buildWeekEntries,
} from '../../scripts/seed-demo.mjs';

const FAKE_CATALOG = [
  { id: 'ing-1', name: 'fresh dill', aliases: ['tilli'] },
  { id: 'ing-2', name: 'salmon', aliases: ['lohi'] },
  { id: 'ing-3', name: 'potato', aliases: ['peruna'] },
];

describe('matchIngredient', () => {
  test('matches by exact name, case-insensitive and trimmed', () => {
    expect(matchIngredient('  Salmon  ', FAKE_CATALOG).id).toBe('ing-2');
    expect(matchIngredient('SALMON', FAKE_CATALOG).id).toBe('ing-2');
  });

  test('matches by alias, case-insensitive and trimmed', () => {
    expect(matchIngredient('Tilli', FAKE_CATALOG).id).toBe('ing-1');
    expect(matchIngredient(' peruna ', FAKE_CATALOG).id).toBe('ing-3');
  });

  test('throws naming the ingredient when nothing matches', () => {
    expect(() => matchIngredient('Oltermanni cheese', FAKE_CATALOG)).toThrow(/Oltermanni cheese/);
  });

  test('every seeded recipe line binds to a real catalog ingredient', () => {
    // A minimal stand-in catalog covering every lookup key the real
    // RECIPES_FIXTURE uses post-resolution (see the substitution table at the
    // top of seed-demo.mjs) — proves buildRecipes resolves every single line
    // instead of silently skipping one, without needing the real 462-row catalog.
    const names = [
      'salmon', 'potato', 'carrot', 'leek', 'cream', 'vegetable stock', 'fresh dill', 'allspice',
      'pork belly', 'beef roast', 'onion', 'bay leaves', 'salt', 'quark', 'lingonberry', 'oats',
      'honey', 'rye bread', 'smoked salmon', 'sour cream', 'black pepper', 'barley', 'mushroom',
      'butter', 'swiss cheese', 'spinach', 'milk', 'all-purpose flour', 'egg',
    ];
    const catalog = names.map((name, i) => ({ id: `id-${i}`, name, aliases: [] }));

    const recipes = buildRecipes(catalog);
    expect(recipes).toHaveLength(7);
    const totalLines = recipes.reduce((sum, r) => sum + r.ingredientLines.length, 0);
    expect(totalLines).toBeGreaterThan(0);
    for (const recipe of recipes) {
      for (const line of recipe.ingredientLines) {
        expect(line.ingredientId).toMatch(/^id-\d+$/);
        expect(typeof line.quantity).toBe('string');
      }
    }
  });

  test('buildRecipes throws naming the line when the catalog is missing an ingredient', () => {
    const sparseCatalog = [{ id: 'x', name: 'salmon', aliases: [] }]; // missing everything else
    expect(() => buildRecipes(sparseCatalog)).toThrow(/No catalog ingredient matches/);
  });
});

describe('resolveDbName', () => {
  test('extracts the database name from a full URL with credentials and query string', () => {
    expect(resolveDbName('postgres://user:pass@host:5432/dietapp_test?sslmode=require')).toBe(
      'dietapp_test',
    );
  });

  test('handles a socket-style URL with no host segment', () => {
    expect(resolveDbName('postgresql://mase@/dietapp_test?host=/var/run/postgresql')).toBe(
      'dietapp_test',
    );
  });

  test('extracts a plain production-shaped name', () => {
    expect(resolveDbName('postgresql://dietapp:secret@localhost:5432/dietapp')).toBe('dietapp');
  });
});

describe('isGuardedDbName', () => {
  test('refuses the production name', () => {
    expect(isGuardedDbName('dietapp')).toBe(false);
  });

  test('allows _test and _dev suffixes', () => {
    expect(isGuardedDbName('dietapp_test')).toBe(true);
    expect(isGuardedDbName('dietapp_dev')).toBe(true);
  });
});

describe('relativeDate', () => {
  const today = new Date('2030-01-15T12:00:00Z'); // arbitrary, far from the prototype's 2026-08 dates

  test('is relative to the given today, not any hardcoded date', () => {
    expect(relativeDate(0, today)).toBe('2030-01-15');
    expect(relativeDate(-1, today)).toBe('2030-01-14');
    expect(relativeDate(3, today)).toBe('2030-01-18');
  });

  test('crosses month/year boundaries correctly', () => {
    const dec31 = new Date('2030-12-31T00:00:00Z');
    expect(relativeDate(1, dec31)).toBe('2031-01-01');
  });

  test('a different "today" shifts every date with it', () => {
    const laterToday = new Date('2031-06-01T00:00:00Z');
    expect(relativeDate(0, laterToday)).toBe('2031-06-01');
    expect(relativeDate(0, laterToday)).not.toBe(relativeDate(0, today));
  });
});

describe('mondayOfIsoWeek', () => {
  test('a Tuesday resolves to the day before it', () => {
    const tuesday = new Date('2026-08-04T00:00:00Z'); // known Tuesday
    expect(mondayOfIsoWeek(tuesday).toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  test('a Sunday resolves to the Monday six days earlier (ISO week, not calendar week)', () => {
    const sunday = new Date('2026-08-09T00:00:00Z');
    expect(mondayOfIsoWeek(sunday).toISOString().slice(0, 10)).toBe('2026-08-03');
  });

  test('a Monday resolves to itself', () => {
    const monday = new Date('2026-08-03T00:00:00Z');
    expect(mondayOfIsoWeek(monday).toISOString().slice(0, 10)).toBe('2026-08-03');
  });
});

describe('buildPantryRows', () => {
  const today = new Date('2026-08-04T00:00:00Z');

  test('produces 15 rows, each with dates relative to today', () => {
    // A tiny fake catalog that happens to cover the pantry fixture's post-
    // resolution lookup keys would be brittle to keep in sync; instead assert
    // the shape/behavior on a catalog covering everything, and that dates are
    // computed (not hardcoded) by checking today's date never appears as a
    // literal in the fixture — every date is derived via relativeDate.
    const names = [
      'fresh dill', 'salmon', 'quark', 'milk', 'spinach', 'chicken thigh', 'rye bread',
      'sour cream', 'carrot', 'swiss cheese', 'potato', 'butter', 'onion', 'barley', 'lingonberry',
    ];
    const catalog = names.map((name, i) => ({ id: `id-${i}`, name, aliases: [] }));

    const rows = buildPantryRows(today, catalog);
    expect(rows).toHaveLength(15);
    for (const row of rows) {
      expect(row.expiresDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // added must always be at or before expires
      expect(row.addedDate <= row.expiresDate).toBe(true);
    }
  });

  test('shifting today shifts every computed date with it (not hardcoded)', () => {
    const names = [
      'fresh dill', 'salmon', 'quark', 'milk', 'spinach', 'chicken thigh', 'rye bread',
      'sour cream', 'carrot', 'swiss cheese', 'potato', 'butter', 'onion', 'barley', 'lingonberry',
    ];
    const catalog = names.map((name, i) => ({ id: `id-${i}`, name, aliases: [] }));

    // buildPantryRows maps the fixture 1:1 in order, so rows[0] is always the
    // "Fresh dill" row (dayOffset -1) regardless of the catalog contents.
    const rowsA = buildPantryRows(new Date('2026-08-04T00:00:00Z'), catalog);
    const rowsB = buildPantryRows(new Date('2026-09-04T00:00:00Z'), catalog);
    expect(rowsA[0].expiresDate).toBe('2026-08-03');
    expect(rowsB[0].expiresDate).toBe('2026-09-03');
    expect(rowsA[0].expiresDate).not.toBe(rowsB[0].expiresDate);
  });
});

describe('buildWeekEntries', () => {
  const today = new Date('2026-08-04T00:00:00Z'); // a Tuesday
  const recipesByTitle = {
    'Rahka & puolukka bowl': 'r-rahka',
    'Karjalanpaisti': 'r-karjalanpaisti',
    'Ruisleipä & graavilohi': 'r-graavilohi',
    'Lohikeitto': 'r-lohikeitto',
    'Pinaattiletut': 'r-pinaattiletut',
    'Uunilohi & juurekset': 'r-uunilohi',
    'Ohrarisotto metsäsienillä': 'r-ohrarisotto',
  };

  test('seeds the ISO week (Mon..Sun) containing today, not a fixed week', () => {
    const rows = buildWeekEntries(today, recipesByTitle);
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    expect(dates[0]).toBe('2026-08-03'); // Monday
    expect(dates[dates.length - 1]).toBe('2026-08-08'); // Saturday (Sunday is entirely empty)
    for (const d of dates) {
      expect(d >= '2026-08-03' && d <= '2026-08-09').toBe(true);
    }
  });

  test('a different today produces a different week', () => {
    // Far enough from the base week (2026-08-03..09) that no ISO week
    // containing it could overlap — a same-month pick like "2026-09-01" can
    // still land in a week starting in August, which isn't the point here.
    const laterToday = new Date('2026-10-01T00:00:00Z');
    const rows = buildWeekEntries(laterToday, recipesByTitle);
    const dates = new Set(rows.map((r) => r.date));
    expect([...dates].some((d) => d.startsWith('2026-08'))).toBe(false);
  });

  test('omits empty slots entirely (no row for Sunday, or Tuesday/Monday snack)', () => {
    const rows = buildWeekEntries(today, recipesByTitle);
    expect(rows.some((r) => r.date === '2026-08-09')).toBe(false); // Sunday
    expect(rows.some((r) => r.date === '2026-08-03' && r.slot === 'snack')).toBe(false);
  });

  test('the substituted friday dinner resolves substituteRecipeId, leaving recipeId null', () => {
    const rows = buildWeekEntries(today, recipesByTitle);
    const fridayDinner = rows.find((r) => r.date === '2026-08-07' && r.slot === 'dinner');
    expect(fridayDinner.status).toBe('substituted');
    expect(fridayDinner.substituteRecipeId).toBe('r-uunilohi');
    expect(fridayDinner.recipeId).toBeNull();
  });

  test('freeform entries carry no recipeId', () => {
    const rows = buildWeekEntries(today, recipesByTitle);
    const mondayLunch = rows.find((r) => r.date === '2026-08-03' && r.slot === 'lunch');
    expect(mondayLunch.freeformNote).toBe('Työlounas — canteen');
    expect(mondayLunch.recipeId).toBeNull();
  });

  test('throws if a referenced title has no known recipe id', () => {
    expect(() => buildWeekEntries(today, {})).toThrow(/no recipe id known/);
  });
});
