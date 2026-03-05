import { pgTable, uuid, text, jsonb, integer, boolean, numeric, timestamp } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { ingredients } from './ingredients.js';

export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  sourceType: text('source_type').notNull(),
  sourceUrl: text('source_url'),
  parentRecipeId: uuid('parent_recipe_id').references((): AnyPgColumn => recipes.id),
  steps: jsonb('steps').notNull().default([]),
  prepTime: integer('prep_time'),
  totalTime: integer('total_time'),
  servings: integer('servings').notNull().default(1),
  effortScore: integer('effort_score'),
  tags: text('tags').array().default([]),
  cuisineType: text('cuisine_type'),
  userRating: integer('user_rating'),
  timesCooked: integer('times_cooked').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipeIngredients = pgTable('recipe_ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
  ingredientId: uuid('ingredient_id').notNull().references(() => ingredients.id),
  quantity: numeric('quantity').notNull(),
  unit: text('unit').notNull(),
  optional: boolean('optional').default(false),
  notes: text('notes'),
});

// Relations are defined in schema/index.ts to avoid circular imports
