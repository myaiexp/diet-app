import { pgTable, uuid, text, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';

export const ingredients = pgTable('ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  aliases: text('aliases').array().default([]),
  category: text('category').notNull(),
  defaultUnit: text('default_unit').notNull(),
  nutritionPer100g: jsonb('nutrition_per_100g').notNull(),
  shelfLife: jsonb('shelf_life').notNull(),
  tags: text('tags').array().default([]),
  // Assumed always on hand (salt, oil, butter) — says nothing about where it is
  // stored; pantry_items.location is the storage place.
  isStaple: boolean('is_staple').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Relations are defined in schema/relations.ts to avoid circular imports
