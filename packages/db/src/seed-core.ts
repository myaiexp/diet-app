// Idempotent database seeding: upserts ingredients, ensures a default profile.

import { sql } from 'drizzle-orm';
import { ingredients, userProfile } from './schema/index.js';
import type { Db } from './connection.js';
import { excludedColumns } from './upsert.js';

// Insert-row shape for the ingredients table; typing the seed rows makes
// column-name typos a compile error instead of a silently-dropped column.
export type IngredientSeedRow = typeof ingredients.$inferInsert;

export interface SeedResult {
  ingredientCount: number;
  profileCreated: boolean;
}

export function resolveConnectionString(env: NodeJS.ProcessEnv): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set');
  }
  return url;
}

// Upsert on the unique `name` so re-running refreshes existing ingredients
// instead of deleting them — a delete would fail on the recipe_ingredients /
// pantry_items foreign keys (no ON DELETE CASCADE) and wipe dependent data.
// Wrapped in a transaction so the ingredient and profile writes are atomic.
export async function seedDatabase(
  db: Db,
  rawIngredients: IngredientSeedRow[],
): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    if (rawIngredients.length > 0) {
      await tx
        .insert(ingredients)
        .values(
          rawIngredients.map((row): IngredientSeedRow => ({
            name: row.name,
            aliases: row.aliases,
            category: row.category,
            defaultUnit: row.defaultUnit,
            nutritionPer100g: row.nutritionPer100g,
            shelfLife: row.shelfLife,
            tags: row.tags,
            isPantryStaple: row.isPantryStaple,
          })),
        )
        .onConflictDoUpdate({
          target: ingredients.name,
          // isPantryStaple is deliberately absent here: it is user-owned,
          // toggled through PATCH /api/ingredients/:id, and the JSON only
          // carries an initial guess. Refreshing it on every re-seed — the
          // idempotent path run whenever ingredient data is regenerated —
          // would silently reset all 462 flags and wipe the user's curation.
          // It stays in the .values() insert shape so a *new* ingredient still
          // gets that guess. Every other column here is catalog data that must
          // keep refreshing.
          set: {
            ...excludedColumns({
              aliases: ingredients.aliases,
              category: ingredients.category,
              defaultUnit: ingredients.defaultUnit,
              nutritionPer100g: ingredients.nutritionPer100g,
              shelfLife: ingredients.shelfLife,
              tags: ingredients.tags,
            }),
            updatedAt: sql`now()`,
          },
        });
    }

    const existingProfiles = await tx.select().from(userProfile).limit(1);
    const profileCreated = existingProfiles.length === 0;
    if (profileCreated) {
      await tx.insert(userProfile).values({
        name: 'Default User',
        householdSize: 1,
        cookingSkill: 'competent',
      });
    }

    return { ingredientCount: rawIngredients.length, profileCreated };
  });
}
