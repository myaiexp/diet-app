import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  date,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ingredients } from './ingredients.js';

export const shoppingLists = pgTable(
  'shopping_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    weekStarting: date('week_starting').notNull(),
    status: text('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One list per week. GET /current picks the newest week <= today, which is
  // ambiguous with two lists for the same Monday; the constraint also turns
  // generate's "does one exist" check from a TOCTOU race into a 23505 → 409.
  (t) => [uniqueIndex('shopping_lists_week_starting_idx').on(t.weekStarting)],
);

export const shoppingListItems = pgTable(
  'shopping_list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listId: uuid('list_id')
      .notNull()
      .references(() => shoppingLists.id),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id),
    quantityNeeded: numeric('quantity_needed').notNull(),
    quantityInPantry: numeric('quantity_in_pantry').notNull().default('0'),
    netToBuy: numeric('net_to_buy').notNull(),
    category: text('category').notNull(),
    // Quantities are stored in the dimension's base unit (g / ml / pieces).
    // Without a unit column a bare `900` cannot be read back as grams or
    // millilitres, and one ingredient appearing as both mass and count in a
    // week's plan (units.ts never crosses dimensions) has nowhere to go.
    unit: text('unit').notNull(),
    // 'generated' | 'manual'. Regeneration prunes only generated unbought rows,
    // so this is what separates "the plan no longer needs it" from "the user
    // typed it".
    source: text('source').notNull().default('generated'),
    // notNull so the "unbought generated rows" delete predicate can't miss NULLs.
    bought: boolean('bought').notNull().default(false),
    customNote: text('custom_note'),
  },
  // Generation upserts on this key, rewriting quantities in place so bought /
  // customNote / manual rows survive. Manual adds normalize their unit to the
  // dimension base first — an un-normalized 'kg' row would sit beside a
  // generated 'g' row instead of colliding with it.
  (t) => [
    uniqueIndex('shopping_list_items_list_ingredient_unit_idx').on(
      t.listId,
      t.ingredientId,
      t.unit,
    ),
  ],
);

// Relations are defined in schema/relations.ts to avoid circular imports
