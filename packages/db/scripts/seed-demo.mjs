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

// ---------------------------------------------------------------------------
// Ingredient name resolution
//
// The prototype's PANTRY/RECIPES arrays use plain-English, sometimes brand- or
// cut-specific names (design-tool copy, same caveat as the invented API
// endpoint names in the frontend design doc). The 462-row catalog
// (packages/db/data/ingredients.json) doesn't always carry that exact string.
// `matchIngredient` itself stays a strict, disciplined case-insensitive/trimmed
// match against `name` or an alias — no fuzzy matching, so a genuine gap fails
// loudly with the name in the message (see seed-demo.test.mjs). Below the
// fixture data is written using resolved catalog lookup keys, and this table
// documents every place a prototype name doesn't reach the catalog verbatim.
// Neither table nor pantry_items nor recipe_ingredients stores a free-text
// ingredient name (only ingredient_id), so choosing a different lookup key
// here costs zero display fidelity — the UI always renders the catalog's own
// name/alias at read time.
//
// Cosmetic renames — same foodstuff, catalog just spells/splits it differently:
//   "Dill"          -> "Fresh dill"        (catalog distinguishes fresh/dried; alias "tilli" is the prototype's own Finnish name for this item)
//   "Salmon fillet" -> "Salmon"            (catalog doesn't model cut)
//   "Bay leaf"      -> "Bay leaves"        (singular vs. plural)
//   "Wheat flour"   -> "All-purpose flour" (Finnish "vehnäjauho" is the catalog's alias for this entry)
//
// Substitutions — the catalog has no equivalent at all; nearest available
// stand-in used so the demo data is still cookable. Reported to the operator
// in the run summary, per the "report it, don't invent catalog rows" rule:
//   "Fish stock"        -> "Vegetable stock" (catalog has chicken/veg/beef stock only)
//   "Pork shoulder"     -> "Pork belly"      (no shoulder/roast cut in catalog)
//   "Beef chuck"        -> "Beef roast"      (closest slow-braise cut available)
//   "Cured salmon"      -> "Smoked salmon"   (no gravlax-style product in catalog)
//   "Forest mushrooms"  -> "Mushroom"        (catalog only has cultivated mushroom)
//   "Oltermanni cheese" -> "Swiss cheese"    (no Finnish semi-hard brand modeled; emmental-style is closest)
//   "Pearl barley"      -> "Barley"          (catalog doesn't distinguish pearled groats from whole barley)
export const CATALOG_SUBSTITUTIONS = {
  'Fish stock': 'Vegetable stock',
  'Pork shoulder': 'Pork belly',
  'Beef chuck': 'Beef roast',
  'Cured salmon': 'Smoked salmon',
  'Forest mushrooms': 'Mushroom',
  'Oltermanni cheese': 'Swiss cheese',
  'Pearl barley': 'Barley',
};

// Case-insensitive, trimmed match against the catalog's name or any alias.
// Never fuzzy, never silent: an unmatched name throws naming itself so a
// prototype/catalog drift is caught at seed time, not as a fabricated id
// silently written to the database.
export function matchIngredient(name, catalog) {
  const needle = name.trim().toLowerCase();
  const found = catalog.find((row) => {
    if (row.name.trim().toLowerCase() === needle) return true;
    return (row.aliases ?? []).some((alias) => alias.trim().toLowerCase() === needle);
  });
  if (!found) {
    throw new Error(`No catalog ingredient matches "${name}" (checked name + aliases, case-insensitive)`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Date helpers — everything below is relative to whatever "today" the script
// is run with, never a hardcoded date, so the spoilage ramp and the meal-plan
// week stay meaningful no matter when the demo gets (re)seeded.

// `daysFromToday` days after `today`, formatted as a Postgres `date` literal.
// Normalizes to UTC midnight first so the offset math can't drift a day from
// the caller's local timezone.
export function relativeDate(daysFromToday, today) {
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  base.setUTCDate(base.getUTCDate() + daysFromToday);
  return base.toISOString().slice(0, 10);
}

// Monday of the ISO week containing `today` (ISO weeks run Mon..Sun).
export function mondayOfIsoWeek(today) {
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const isoDay = base.getUTCDay() === 0 ? 7 : base.getUTCDay(); // 1=Mon .. 7=Sun
  base.setUTCDate(base.getUTCDate() - (isoDay - 1));
  return base;
}

// ---------------------------------------------------------------------------
// Database-name guard — refuses to run against anything but an obviously
// disposable database unless told to. Mirrors scripts/setup-test-db.sh's
// db_name_from_url shell logic in JS: strip scheme, drop the authority, drop
// the query string, drop any trailing path segment.
export function resolveDbName(connectionString) {
  const schemeIdx = connectionString.indexOf('://');
  const afterScheme = schemeIdx === -1 ? connectionString : connectionString.slice(schemeIdx + 3);
  const slashIdx = afterScheme.indexOf('/');
  const path = slashIdx === -1 ? '' : afterScheme.slice(slashIdx + 1);
  return path.split('?')[0].split('/')[0];
}

export function isGuardedDbName(name) {
  return name.endsWith('_test') || name.endsWith('_dev');
}

// ---------------------------------------------------------------------------
// Fixture data, transcribed from docs/plans/assets/ruoka-prototype.dc.html's
// PANTRY/RECIPES arrays (see the resolution table above for name changes).

// Days-to-expiry (`dayOffset`) and days-since-added (`addedOffset`) are both
// offsets from "today", derived once from the prototype's own absolute dates
// (its implicit "today" was 2026-08-04) so the ramp — and the gap between
// added and expires — reproduces the original design at any run date.
const PANTRY_FIXTURE = [
  { name: 'Fresh dill', qty: 20, unit: 'g', location: 'fridge', dayOffset: -1, addedOffset: -9, opened: false },
  { name: 'Salmon', qty: 400, unit: 'g', location: 'fridge', dayOffset: 0, addedOffset: -2, opened: false },
  { name: 'Quark', qty: 500, unit: 'g', location: 'fridge', dayOffset: 1, addedOffset: -5, opened: true },
  { name: 'Milk', qty: 1, unit: 'l', location: 'fridge', dayOffset: 2, addedOffset: -3, opened: true },
  { name: 'Spinach', qty: 200, unit: 'g', location: 'fridge', dayOffset: 2, addedOffset: -3, opened: false },
  { name: 'Chicken thigh', qty: 600, unit: 'g', location: 'fridge', dayOffset: 3, addedOffset: -2, opened: false },
  { name: 'Rye bread', qty: 6, unit: 'pcs', location: 'counter', dayOffset: 4, addedOffset: -3, opened: false },
  { name: 'Sour cream', qty: 200, unit: 'ml', location: 'fridge', dayOffset: 5, addedOffset: -7, opened: false },
  { name: 'Carrot', qty: 700, unit: 'g', location: 'fridge', dayOffset: 12, addedOffset: -8, opened: false },
  { name: 'Swiss cheese', qty: 400, unit: 'g', location: 'fridge', dayOffset: 14, addedOffset: -8, opened: false },
  { name: 'Potato', qty: 2, unit: 'kg', location: 'pantry', dayOffset: 21, addedOffset: -15, opened: false },
  { name: 'Butter', qty: 250, unit: 'g', location: 'fridge', dayOffset: 30, addedOffset: -13, opened: true },
  { name: 'Onion', qty: 1, unit: 'kg', location: 'pantry', dayOffset: 34, addedOffset: -15, opened: false },
  { name: 'Barley', qty: 900, unit: 'g', location: 'pantry', dayOffset: 210, addedOffset: -62, opened: false },
  { name: 'Lingonberry', qty: 300, unit: 'g', location: 'freezer', dayOffset: 240, addedOffset: -326, opened: false },
];

const RECIPES_FIXTURE = [
  {
    title: 'Lohikeitto',
    sourceType: 'manual',
    prepTime: 15,
    totalTime: 35,
    servings: 4,
    effortScore: 2,
    userRating: 5,
    timesCooked: 11,
    cuisineType: 'finnish',
    tags: ['soup', 'fish', 'quick'],
    ingredients: [
      { name: 'Salmon', qty: 400, unit: 'g', notes: 'cubed' },
      { name: 'Potato', qty: 500, unit: 'g' },
      { name: 'Carrot', qty: 150, unit: 'g' },
      { name: 'Leek', qty: 1, unit: 'pcs' },
      { name: 'Cream', qty: 2, unit: 'dl' },
      { name: 'Vegetable stock', qty: 1, unit: 'l' },
      { name: 'Fresh dill', qty: 15, unit: 'g', notes: 'at the end' },
      { name: 'Allspice', qty: 6, unit: 'pcs', optional: true },
    ],
    steps: [
      'Simmer potato, carrot and leek in the stock 12 min.',
      'Add the salmon, take off the boil, 6 min more.',
      'Cream in, warm through — never boil after this.',
      'Dill off heat. Rest 10 min before serving.',
    ],
  },
  {
    title: 'Karjalanpaisti',
    sourceType: 'manual',
    prepTime: 20,
    totalTime: 190,
    servings: 6,
    effortScore: 2,
    userRating: 5,
    timesCooked: 3,
    cuisineType: 'finnish',
    tags: ['oven', 'slow', 'pork'],
    ingredients: [
      { name: 'Pork belly', qty: 700, unit: 'g' },
      { name: 'Beef roast', qty: 500, unit: 'g' },
      { name: 'Onion', qty: 400, unit: 'g' },
      { name: 'Carrot', qty: 300, unit: 'g' },
      { name: 'Allspice', qty: 12, unit: 'pcs' },
      { name: 'Bay leaves', qty: 2, unit: 'pcs', optional: true },
      { name: 'Salt', qty: 2, unit: 'tsp' },
    ],
    steps: [
      'Layer meat, onion, carrot and spice in a pot.',
      'Water to just cover. Lid on.',
      "175 °C for three hours. Don't stir.",
      'Salt at the end, taste twice.',
    ],
  },
  {
    title: 'Rahka & puolukka bowl',
    sourceType: 'manual',
    prepTime: 5,
    totalTime: 5,
    servings: 1,
    effortScore: 1,
    userRating: 4,
    timesCooked: 24,
    cuisineType: 'finnish',
    tags: ['breakfast', 'no-cook', 'quick'],
    ingredients: [
      { name: 'Quark', qty: 250, unit: 'g' },
      { name: 'Lingonberry', qty: 60, unit: 'g' },
      { name: 'Oats', qty: 30, unit: 'g' },
      { name: 'Honey', qty: 1, unit: 'tsp', optional: true },
    ],
    steps: [
      'Quark in a bowl.',
      'Berries on top, still half frozen.',
      'Oats, honey if the berries fight back.',
    ],
  },
  {
    title: 'Ruisleipä & graavilohi',
    sourceType: 'manual',
    prepTime: 6,
    totalTime: 6,
    servings: 2,
    effortScore: 1,
    userRating: 5,
    timesCooked: 9,
    cuisineType: 'finnish',
    tags: ['lunch', 'no-cook', 'fish'],
    ingredients: [
      { name: 'Rye bread', qty: 4, unit: 'pcs' },
      { name: 'Smoked salmon', qty: 120, unit: 'g' },
      { name: 'Sour cream', qty: 60, unit: 'ml' },
      { name: 'Fresh dill', qty: 8, unit: 'g' },
      { name: 'Black pepper', qty: 1, unit: 'tsp', optional: true },
    ],
    steps: ['Sour cream on the bread, thin.', 'Salmon, dill, pepper.', 'Eat standing up.'],
  },
  {
    title: 'Ohrarisotto metsäsienillä',
    sourceType: 'imported',
    prepTime: 15,
    totalTime: 40,
    servings: 4,
    effortScore: 3,
    userRating: 4,
    timesCooked: 2,
    cuisineType: 'finnish',
    tags: ['vegetarian', 'grain'],
    ingredients: [
      { name: 'Barley', qty: 300, unit: 'g' },
      { name: 'Mushroom', qty: 250, unit: 'g' },
      { name: 'Onion', qty: 150, unit: 'g' },
      { name: 'Butter', qty: 40, unit: 'g' },
      { name: 'Vegetable stock', qty: 9, unit: 'dl' },
      { name: 'Swiss cheese', qty: 80, unit: 'g' },
      { name: 'Fresh dill', qty: 10, unit: 'g', optional: true },
    ],
    steps: [
      'Dry-fry the mushrooms until the water is gone.',
      'Butter and onion, soften without colour.',
      'Barley in, toast a minute, then stock a ladle at a time.',
      '25–30 min, stirring. Grain tender with bite.',
      'Cheese and dill off heat.',
    ],
  },
  {
    title: 'Pinaattiletut',
    sourceType: 'manual',
    prepTime: 10,
    totalTime: 25,
    servings: 3,
    effortScore: 2,
    userRating: 4,
    timesCooked: 5,
    cuisineType: 'finnish',
    tags: ['vegetarian', 'quick'],
    ingredients: [
      { name: 'Spinach', qty: 200, unit: 'g' },
      { name: 'Milk', qty: 4, unit: 'dl' },
      { name: 'All-purpose flour', qty: 180, unit: 'g' },
      { name: 'Egg', qty: 2, unit: 'pcs' },
      { name: 'Butter', qty: 30, unit: 'g' },
      { name: 'Salt', qty: 1, unit: 'tsp' },
    ],
    steps: [
      'Wilt the spinach, chop it fine.',
      'Batter, rest 20 min.',
      'Thin pancakes in butter, hot pan.',
      'Lingonberry jam alongside.',
    ],
  },
  {
    title: 'Uunilohi & juurekset',
    sourceType: 'ai',
    prepTime: 10,
    totalTime: 45,
    servings: 4,
    effortScore: 1,
    userRating: 4,
    timesCooked: 1,
    cuisineType: 'finnish',
    tags: ['oven', 'fish', 'one-pan'],
    ingredients: [
      { name: 'Salmon', qty: 600, unit: 'g' },
      { name: 'Potato', qty: 700, unit: 'g' },
      { name: 'Carrot', qty: 300, unit: 'g' },
      { name: 'Onion', qty: 200, unit: 'g' },
      { name: 'Butter', qty: 30, unit: 'g' },
      { name: 'Fresh dill', qty: 10, unit: 'g', optional: true },
    ],
    steps: ['Roots in the tray, 200 °C, 25 min.', 'Salmon on top, butter, 15 min more.', 'Dill, lemon if you have it.'],
  },
];

// Seed meal-plan week, transcribed from the frontend design doc's "Meal plan —
// the week" section (the prototype itself only renders this, it doesn't carry
// it as fixture data). `offset` is days from the Monday of the ISO week
// containing "today" (0=Mon..6=Sun). A `null` cell means the design's "empty"
// state — no row is written for it, matching how the UI treats an unfilled
// slot as absent rather than a status value.
const WEEK_TEMPLATE = [
  {
    offset: 0, // monday
    slots: {
      breakfast: { title: 'Rahka & puolukka bowl', status: 'cooked', servings: 1 },
      lunch: { freeformNote: 'Työlounas — canteen', status: 'planned', servings: 1 },
      dinner: { title: 'Karjalanpaisti', status: 'cooked', servings: 6 },
      snack: null,
    },
  },
  {
    offset: 1, // tuesday
    slots: {
      breakfast: { title: 'Rahka & puolukka bowl', status: 'cooked', servings: 1 },
      lunch: { title: 'Ruisleipä & graavilohi', status: 'cooked', servings: 2 },
      dinner: { title: 'Lohikeitto', status: 'planned', servings: 4 },
      snack: null,
    },
  },
  {
    offset: 2, // wednesday
    slots: {
      breakfast: { title: 'Rahka & puolukka bowl', status: 'planned', servings: 1 },
      lunch: { title: 'Karjalanpaisti', status: 'planned', servings: 2, notes: 'leftovers' },
      dinner: { title: 'Pinaattiletut', status: 'planned', servings: 3 },
      snack: null,
    },
  },
  {
    offset: 3, // thursday
    slots: {
      breakfast: { title: 'Rahka & puolukka bowl', status: 'planned', servings: 1 },
      lunch: null,
      dinner: { title: 'Uunilohi & juurekset', status: 'skipped', servings: 4 },
      snack: null,
    },
  },
  {
    offset: 4, // friday
    slots: {
      breakfast: null,
      lunch: { title: 'Ohrarisotto metsäsienillä', status: 'planned', servings: 4 },
      // "substituted": the design shows only the recipe actually used, not
      // what was originally planned, so recipeId is left null and the shown
      // recipe goes in substituteRecipeId — cook-plan.ts resolves the recipe
      // actually cooked as `substituteRecipeId ?? recipeId`, which is exactly
      // this cell's intent.
      dinner: { substituteTitle: 'Uunilohi & juurekset', status: 'substituted', servings: 4 },
      snack: { freeformNote: 'Rye bread & cheese', status: 'planned', servings: 1 },
    },
  },
  {
    offset: 5, // saturday
    slots: {
      breakfast: { title: 'Pinaattiletut', status: 'planned', servings: 3 },
      lunch: null,
      dinner: { title: 'Karjalanpaisti', status: 'planned', servings: 6 },
      snack: null,
    },
  },
  {
    offset: 6, // sunday — entirely empty, per the design
    slots: { breakfast: null, lunch: null, dinner: null, snack: null },
  },
];

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

// ---------------------------------------------------------------------------
// main() — the only part that touches Postgres. Dynamic imports keep the
// module's static import graph free of dotenv/drizzle/pg, so importing this
// file for its pure helpers (as the unit tests do) never needs `dist/` built
// or a database reachable.
async function main() {
  const force = process.argv.includes('--force');

  const { config } = await import('dotenv');
  config({ path: '../../.env' });

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
  const { ingredients, recipes, recipeIngredients, pantryItems, mealPlanEntries } = await import(
    '../dist/schema/index.js'
  );
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
  };

  try {
    const catalog = await db.select().from(ingredients);
    // Resolve every ingredient line up front — a genuine catalog gap fails
    // loudly here, before any write happens.
    const recipeSeeds = buildRecipes(catalog);
    const pantryRows = buildPantryRows(today, catalog);

    await db.transaction(async (tx) => {
      const recipesByTitle = {};

      for (const recipe of recipeSeeds) {
        const existing = await tx.select().from(recipes).where(eq(recipes.title, recipe.title)).limit(1);
        let recipeId;
        if (existing.length > 0) {
          recipeId = existing[0].id;
          await tx
            .update(recipes)
            .set({
              sourceType: recipe.sourceType,
              sourceUrl: recipe.sourceUrl,
              steps: recipe.steps,
              prepTime: recipe.prepTime,
              totalTime: recipe.totalTime,
              servings: recipe.servings,
              effortScore: recipe.effortScore,
              tags: recipe.tags,
              cuisineType: recipe.cuisineType,
              userRating: recipe.userRating,
              timesCooked: recipe.timesCooked,
              updatedAt: sql`now()`,
            })
            .where(eq(recipes.id, recipeId));
          await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
          summary.recipesUpdated++;
        } else {
          const inserted = await tx
            .insert(recipes)
            .values({
              title: recipe.title,
              sourceType: recipe.sourceType,
              sourceUrl: recipe.sourceUrl,
              steps: recipe.steps,
              prepTime: recipe.prepTime,
              totalTime: recipe.totalTime,
              servings: recipe.servings,
              effortScore: recipe.effortScore,
              tags: recipe.tags,
              cuisineType: recipe.cuisineType,
              userRating: recipe.userRating,
              timesCooked: recipe.timesCooked,
            })
            .returning({ id: recipes.id });
          recipeId = inserted[0].id;
          summary.recipesInserted++;
        }
        recipesByTitle[recipe.title] = recipeId;

        if (recipe.ingredientLines.length > 0) {
          await tx
            .insert(recipeIngredients)
            .values(recipe.ingredientLines.map((line) => ({ recipeId, ...line })));
          summary.recipeIngredientLines += recipe.ingredientLines.length;
        }
      }

      for (const row of pantryRows) {
        const existing = await tx
          .select()
          .from(pantryItems)
          .where(and(eq(pantryItems.ingredientId, row.ingredientId), eq(pantryItems.location, row.location)))
          .limit(1);
        if (existing.length > 0) {
          await tx
            .update(pantryItems)
            .set({
              quantity: row.quantity,
              unit: row.unit,
              addedDate: row.addedDate,
              expiresDate: row.expiresDate,
              opened: row.opened,
              updatedAt: sql`now()`,
            })
            .where(eq(pantryItems.id, existing[0].id));
          summary.pantryUpdated++;
        } else {
          await tx.insert(pantryItems).values(row);
          summary.pantryInserted++;
        }
      }

      const weekRows = buildWeekEntries(today, recipesByTitle);
      for (const row of weekRows) {
        const existing = await tx
          .select()
          .from(mealPlanEntries)
          .where(and(eq(mealPlanEntries.date, row.date), eq(mealPlanEntries.slot, row.slot)))
          .limit(1);
        if (existing.length > 0) {
          await tx
            .update(mealPlanEntries)
            .set({
              recipeId: row.recipeId,
              substituteRecipeId: row.substituteRecipeId,
              freeformNote: row.freeformNote,
              servings: row.servings,
              status: row.status,
              notes: row.notes,
              updatedAt: sql`now()`,
            })
            .where(eq(mealPlanEntries.id, existing[0].id));
          summary.weekEntriesUpdated++;
        } else {
          await tx.insert(mealPlanEntries).values(row);
          summary.weekEntriesInserted++;
        }
      }
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
