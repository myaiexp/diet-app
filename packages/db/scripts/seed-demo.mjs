#!/usr/bin/env node
// Demo-data seed: writes the frontend design prototype's mock pantry (15
// items), recipe collection (7 recipes), and a seed meal-plan week as real
// rows, so a demo/dev environment starts populated instead of empty.
// Source of truth for the fixture shape: docs/plans/assets/ruoka-prototype.dc.html
// (PANTRY/RECIPES arrays) cross-checked against docs/plans/2026-08-04-frontend-design.md
// sections 2/3/5 (the meal-plan week is only described in prose there).
//
// Run: pnpm --filter @diet-app/db build && pnpm --filter @diet-app/db seed:demo [--force]
//
// Pure helpers (matchIngredient, buildPantryRows, buildRecipes, buildWeekEntries,
// relativeDate, resolveDbName, isGuardedDbName, mondayOfIsoWeek) do no I/O and
// are exported for unit testing. Everything that touches Postgres lives in
// main(), which only runs when this file is executed directly — importing the
// module (as the test file does) never needs a build or a database.

import {
  CATALOG_SUBSTITUTIONS,
  matchIngredient,
  relativeDate,
  mondayOfIsoWeek,
  resolveDbName,
  isGuardedDbName,
} from './seed-demo-lib.mjs';
import { PANTRY_FIXTURE, WEEK_TEMPLATE, PROFILE_FIXTURE } from './seed-demo-fixtures.mjs';
import { RECIPES_FIXTURE } from './seed-demo-recipes.mjs';
import {
  writeRecipes,
  writePantry,
  writeWeek,
  writeProfile,
} from './seed-demo-write.mjs';

// One public entry point: the unit tests (and any future caller) import the
// pure helpers from here rather than reaching into the split modules.
export {
  CATALOG_SUBSTITUTIONS,
  matchIngredient,
  relativeDate,
  mondayOfIsoWeek,
  resolveDbName,
  isGuardedDbName,
};

// ---------------------------------------------------------------------------
// Pure builders — resolve fixture data against a real catalog / recipe-id map.
// No I/O; catalog and recipesByTitle are handed in so these are unit-testable
// without a database.

export function buildPantryRows(today, catalog) {
  return PANTRY_FIXTURE.map((item) => {
    const ingredient = matchIngredient(item.name, catalog);
    return {
      ingredientId: ingredient.id,
      quantity: String(item.qty),
      unit: item.unit,
      location: item.location,
      addedDate: relativeDate(item.addedOffset, today),
      expiresDate: relativeDate(item.dayOffset, today),
      opened: item.opened,
    };
  });
}

export function buildRecipes(catalog) {
  return RECIPES_FIXTURE.map((recipe) => ({
    title: recipe.title,
    sourceType: recipe.sourceType,
    sourceUrl: null,
    steps: recipe.steps,
    prepTime: recipe.prepTime,
    totalTime: recipe.totalTime,
    servings: recipe.servings,
    effortScore: recipe.effortScore,
    tags: recipe.tags,
    cuisineType: recipe.cuisineType,
    userRating: recipe.userRating,
    timesCooked: recipe.timesCooked,
    ingredientLines: recipe.ingredients.map((line) => {
      const ingredient = matchIngredient(line.name, catalog);
      return {
        ingredientId: ingredient.id,
        quantity: String(line.qty),
        unit: line.unit,
        optional: line.optional ?? false,
        notes: line.notes ?? null,
      };
    }),
  }));
}

function resolveRecipeId(title, recipesByTitle, field) {
  const id = recipesByTitle[title];
  if (!id) {
    throw new Error(
      `buildWeekEntries: no recipe id known for "${title}" (${field}) — recipes must be written before the week`,
    );
  }
  return id;
}

export function buildWeekEntries(today, recipesByTitle) {
  const monday = mondayOfIsoWeek(today);
  const rows = [];
  for (const day of WEEK_TEMPLATE) {
    const date = relativeDate(day.offset, monday);
    for (const [slot, cell] of Object.entries(day.slots)) {
      if (!cell) continue; // design's "empty" state — no row
      rows.push({
        date,
        slot,
        recipeId: cell.title ? resolveRecipeId(cell.title, recipesByTitle, 'recipeId') : null,
        substituteRecipeId: cell.substituteTitle
          ? resolveRecipeId(cell.substituteTitle, recipesByTitle, 'substituteRecipeId')
          : null,
        freeformNote: cell.freeformNote ?? null,
        servings: String(cell.servings),
        status: cell.status,
        notes: cell.notes ?? null,
      });
    }
  }
  return rows;
}


/**
 * The profile row's demo values, with the disliked-ingredient names resolved to
 * catalog ids. Kept pure (catalog handed in) like every other builder, so an
 * unmatched dislike fails loudly before any write.
 */
export function buildProfile(catalog) {
  const { dislikedIngredients, ...columns } = PROFILE_FIXTURE;
  return {
    columns,
    dislikedIds: dislikedIngredients.map((name) => matchIngredient(name, catalog).id),
  };
}

// ---------------------------------------------------------------------------
// main() — the only part that touches Postgres. Dynamic imports keep the
// module's static import graph free of dotenv/drizzle/pg, so importing this
// file for its pure helpers (as the unit tests do) never needs `dist/` built
// or a database reachable.
async function main() {
  const force = process.argv.includes('--force');

  const { config } = await import('dotenv');
  config({ path: '../../.env', quiet: true });

  const { resolveConnectionString } = await import('../dist/seed-core.js');
  const connectionString = resolveConnectionString(process.env);

  // Identity note (contract #1): recipes have no unique constraint on `title`
  // and pantry_items/meal_plan_entries have no natural key at all, so ON
  // CONFLICT can't do the idempotency work here. Identity is decided per
  // table instead:
  //   - recipes:            exact `title` match. These are curated demo
  //     titles we own; re-running updates the row's fields in place and
  //     replaces its ingredient lines wholesale (delete + reinsert) since
  //     recipe_ingredients has no unique key either — diffing line-by-line
  //     would need one anyway, and a full replace can't accumulate stale rows.
  //   - pantry_items:       (ingredient_id, location) pair. Each demo
  //     ingredient occupies exactly one location in the fixture, so the pair
  //     is a stable key even though the table enforces nothing.
  //   - meal_plan_entries:  (date, slot) pair — the 7×4 grid model allows at
  //     most one entry per day×slot, so that pair is the natural key.
  // All three are looked up, then updated in place or inserted — never
  // deleted — so a rerun on a later date just adds/refreshes rows rather than
  // destroying history from a previous demo week.
  const dbName = resolveDbName(connectionString);
  if (!isGuardedDbName(dbName) && !force) {
    console.error(
      `Refusing to seed demo data into database "${dbName}" — name must end in "_test" or "_dev". ` +
        'Pass --force to override (never do this against the production "dietapp" database).',
    );
    process.exit(1);
  }

  const { createDb } = await import('../dist/connection.js');
  // Imported dynamically (and after the guard) so this module stays importable
  // without a build — the unit tests exercise the pure helpers, not this path.
  const tables = await import('../dist/schema/index.js');
  const { ingredients } = tables;
  const { eq, and, sql } = await import('drizzle-orm');

  const db = createDb(connectionString);
  const today = new Date();
  const summary = {
    recipesInserted: 0,
    recipesUpdated: 0,
    recipeIngredientLines: 0,
    pantryInserted: 0,
    pantryUpdated: 0,
    weekEntriesInserted: 0,
    weekEntriesUpdated: 0,
    profileUpdated: false,
    dislikes: 0,
  };

  try {
    const catalog = await db.select().from(ingredients);
    // Resolve every ingredient line up front — a genuine catalog gap fails
    // loudly here, before any write happens.
    const recipeSeeds = buildRecipes(catalog);
    const pantryRows = buildPantryRows(today, catalog);
    const profile = buildProfile(catalog);

    await db.transaction(async (tx) => {
      const ctx = { tables, ops: { eq, and, sql } };
      const recipesByTitle = await writeRecipes(tx, ctx, recipeSeeds, summary);
      await writePantry(tx, ctx, pantryRows, summary);
      await writeWeek(tx, ctx, buildWeekEntries(today, recipesByTitle), summary);
      await writeProfile(tx, ctx, profile, summary);
    });

    const substituted = Object.entries(CATALOG_SUBSTITUTIONS);
    console.log(`Seeded demo data into "${dbName}":`);
    console.log(
      `  recipes:        ${summary.recipesInserted} inserted, ${summary.recipesUpdated} updated ` +
        `(${summary.recipeIngredientLines} ingredient lines written)`,
    );
    console.log(`  pantry items:   ${summary.pantryInserted} inserted, ${summary.pantryUpdated} updated`);
    console.log(`  meal plan week: ${summary.weekEntriesInserted} inserted, ${summary.weekEntriesUpdated} updated`);
    console.log(
      summary.profileUpdated
        ? `  profile:        updated (${summary.dislikes} disliked ingredients)`
        : '  profile:        SKIPPED — no user_profile row (run db:seed first)',
    );
    console.log(
      `  catalog gaps:   ${substituted.length} prototype ingredient(s) had no catalog match and were ` +
        'substituted (see CATALOG_SUBSTITUTIONS at the top of this file):',
    );
    for (const [original, substitute] of substituted) {
      console.log(`    "${original}" -> "${substitute}"`);
    }
    console.log('Done!');
  } finally {
    await db.$client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('seed:demo failed:', err);
    process.exit(1);
  });
}

