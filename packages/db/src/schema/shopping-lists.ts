import { pgTable, uuid, text, numeric, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import { ingredients } from './ingredients.js';

export const shoppingLists = pgTable('shopping_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekStarting: date('week_starting').notNull(),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shoppingListItems = pgTable('shopping_list_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  listId: uuid('list_id').notNull().references(() => shoppingLists.id),
  ingredientId: uuid('ingredient_id').notNull().references(() => ingredients.id),
  quantityNeeded: numeric('quantity_needed').notNull(),
  quantityInPantry: numeric('quantity_in_pantry').notNull().default('0'),
  netToBuy: numeric('net_to_buy').notNull(),
  category: text('category').notNull(),
  bought: boolean('bought').default(false),
  customNote: text('custom_note'),
});

// Relations are defined in schema/index.ts to avoid circular imports
