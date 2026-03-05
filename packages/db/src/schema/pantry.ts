import { pgTable, uuid, text, numeric, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import { ingredients } from './ingredients.js';

export const pantryItems = pgTable('pantry_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  ingredientId: uuid('ingredient_id').notNull().references(() => ingredients.id),
  quantity: numeric('quantity').notNull(),
  unit: text('unit').notNull(),
  location: text('location').notNull(),
  addedDate: date('added_date').notNull(),
  expiresDate: date('expires_date').notNull(),
  opened: boolean('opened').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Relations are defined in schema/index.ts to avoid circular imports
