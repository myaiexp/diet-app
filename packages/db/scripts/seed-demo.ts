// CLI entry: seed the frontend design prototype's demo data (`pnpm seed:demo`).
//
// Writes the prototype's mock pantry (15 items), recipe collection (7 recipes),
// a seed meal-plan week and the profile as real rows, so a demo/dev environment
// starts populated instead of empty. Source of truth for the fixture shape:
// docs/plans/assets/ruoka-prototype.dc.html (PANTRY/RECIPES arrays) cross-checked
// against docs/plans/2026-08-04-frontend-design.md sections 2/3/5 (the meal-plan
// week is only described in prose there).
//
// Run: pnpm --filter @diet-app/db seed:demo [--force]
//
// Fixtures live in seed-demo-fixtures.ts / seed-demo-recipes.ts, the pure
// builders that resolve them in seed-demo-build.ts, the per-table writes in
// seed-demo-write.ts. This file only wires them to a connection.

import { createDb } from '../src/connection.js';
import { loadRepoEnv } from '../src/load-env.js';
import { resolveConnectionString } from '../src/seed-core.js';
import { ingredients } from '../src/schema/index.js';
import { CATALOG_SUBSTITUTIONS, resolveDbName, isGuardedDbName } from './seed-demo-lib.js';
import { buildPantryRows, buildProfile, buildRecipes, buildWeekEntries } from './seed-demo-build.js';
import { writeRecipes, writePantry, writeWeek, writeProfile, type SeedSummary } from './seed-demo-write.js';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  loadRepoEnv();
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

  const db = createDb(connectionString);
  const today = new Date();
  const summary: SeedSummary = {
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
      const recipesByTitle = await writeRecipes(tx, recipeSeeds, summary);
      await writePantry(tx, pantryRows, summary);
      await writeWeek(tx, buildWeekEntries(today, recipesByTitle), summary);
      await writeProfile(tx, profile, summary);
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
        'substituted (see CATALOG_SUBSTITUTIONS in seed-demo-lib.ts):',
    );
    for (const [original, substitute] of substituted) {
      console.log(`    "${original}" -> "${substitute}"`);
    }
    console.log('Done!');
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error('seed:demo failed:', err);
  process.exit(1);
});
