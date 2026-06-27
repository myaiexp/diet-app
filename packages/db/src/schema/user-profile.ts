import { pgTable, uuid, text, integer, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { ingredients } from './ingredients.js';

export const userProfile = pgTable('user_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  calorieTargetMin: integer('calorie_target_min'),
  calorieTargetMax: integer('calorie_target_max'),
  macroTargets: jsonb('macro_targets'),
  dietaryRestrictions: text('dietary_restrictions').array().default([]),
  cookingSkill: text('cooking_skill').notNull().default('competent'),
  kitchenEquipment: text('kitchen_equipment').array().default([]),
  householdSize: integer('household_size').notNull().default(1),
  scheduleProfile: jsonb('schedule_profile').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Disliked ingredients: a junction table instead of a uuid[] on user_profile.
// An array column can't carry a foreign key, so deleting an ingredient would
// leave stale UUIDs behind and Drizzle can't define a relation over it. The
// composite PK dedupes (userId, ingredientId); both FKs cascade on delete so a
// removed ingredient (or profile) self-cleans from the disliked set.
export const userDislikedIngredients = pgTable(
  'user_disliked_ingredients',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ingredientId] })],
);

// Relations are defined in schema/relations.ts to avoid circular imports
