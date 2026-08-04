// The demo seed's write steps, one per table.
//
// Each takes the transaction plus a `ctx` carrying the schema tables and the
// drizzle operators main() already imported from ../dist — so this module
// stays importable (and the seed's pure parts testable) without a build.
//
// Identity is explicit everywhere because none of these tables has a unique
// key to conflict on: a recipe is its title, a pantry item is
// (ingredient_id, location), a plan entry is (date, slot), and the profile is
// the singleton row. Update-or-insert, never delete-and-recreate, so a rerun
// refreshes rows instead of churning ids that other rows reference.

/** Upsert the recipes and replace their ingredient lines. Returns id-by-title. */
export async function writeRecipes(tx, ctx, recipeSeeds, summary) {
  const { recipes, recipeIngredients } = ctx.tables;
  const { eq, sql } = ctx.ops;
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
  return recipesByTitle;
}

/** Upsert the pantry rows, keyed on (ingredient_id, location). */
export async function writePantry(tx, ctx, pantryRows, summary) {
  const { pantryItems } = ctx.tables;
  const { eq, and, sql } = ctx.ops;
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
}

/** Upsert the seed week's entries, keyed on (date, slot). */
export async function writeWeek(tx, ctx, weekRows, summary) {
  const { mealPlanEntries } = ctx.tables;
  const { eq, and, sql } = ctx.ops;
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
}

/** Update the singleton profile row and replace its disliked-ingredient set. */
export async function writeProfile(tx, ctx, profile, summary) {
  const { userProfile, userDislikedIngredients } = ctx.tables;
  const { eq, sql } = ctx.ops;
  // The singleton profile row already exists (seed-core.ts creates a
  // "Default User" with empty targets), so this updates it in place —
  // idempotent without needing an identity rule of its own. Without it the
  // profile screen demos as a blank form.
  const [existingProfile] = await tx.select().from(userProfile).limit(1);
  if (existingProfile) {
    await tx
      .update(userProfile)
      .set({ ...profile.columns, updatedAt: sql`now()` })
      .where(eq(userProfile.id, existingProfile.id));
    await tx
      .delete(userDislikedIngredients)
      .where(eq(userDislikedIngredients.userId, existingProfile.id));
    if (profile.dislikedIds.length > 0) {
      await tx.insert(userDislikedIngredients).values(
        profile.dislikedIds.map((ingredientId) => ({
          userId: existingProfile.id,
          ingredientId,
        })),
      );
    }
    summary.profileUpdated = true;
    summary.dislikes = profile.dislikedIds.length;
  }
}

