// Idempotent database seeding: upserts ingredients, ensures a default profile.

import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { ingredients, userProfile } from './schema/index.js';
import type { Db } from './connection.js';

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

// Build an `ON CONFLICT DO UPDATE SET` that copies each given column from the
// proposed row (excluded.*). Column SQL names are read from the schema so a
// rename can't silently desync the update list.
function excludedColumns<T extends Record<string, PgColumn>>(cols: T): Record<keyof T, SQL> {
  return Object.fromEntries(
    Object.entries(cols).map(([key, col]) => [key, sql.raw(`excluded.${col.name}`)]),
  ) as Record<keyof T, SQL>;
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
          set: {
            ...excludedColumns({
              aliases: ingredients.aliases,
              category: ingredients.category,
              defaultUnit: ingredients.defaultUnit,
              nutritionPer100g: ingredients.nutritionPer100g,
              shelfLife: ingredients.shelfLife,
              tags: ingredients.tags,
              isPantryStaple: ingredients.isPantryStaple,
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
