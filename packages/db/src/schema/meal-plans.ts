import { pgTable, uuid, text, numeric, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { recipes } from './recipes.js';

export const mealPlanEntries = pgTable('meal_plan_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  slot: text('slot').notNull(),
  recipeId: uuid('recipe_id').references(() => recipes.id),
  freeformNote: text('freeform_note'),
  servings: numeric('servings').notNull().default('1'),
  status: text('status').notNull().default('planned'),
  substituteRecipeId: uuid('substitute_recipe_id').references((): AnyPgColumn => recipes.id),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cookFeedback = pgTable('cook_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  mealPlanEntryId: uuid('meal_plan_entry_id').notNull().unique().references(() => mealPlanEntries.id),
  rating: text('rating').notNull(),
  effortCheck: text('effort_check').notNull(),
  makeAgain: text('make_again').notNull(),
  usedAsIs: boolean('used_as_is').notNull(),
  changesNote: text('changes_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Relations are defined in schema/index.ts to avoid circular imports
