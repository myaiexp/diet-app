import { pgTable, uuid, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const userProfile = pgTable('user_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  calorieTargetMin: integer('calorie_target_min'),
  calorieTargetMax: integer('calorie_target_max'),
  macroTargets: jsonb('macro_targets'),
  dietaryRestrictions: text('dietary_restrictions').array().default([]),
  dislikedIngredientIds: uuid('disliked_ingredient_ids').array().default([]),
  cookingSkill: text('cooking_skill').notNull().default('competent'),
  kitchenEquipment: text('kitchen_equipment').array().default([]),
  householdSize: integer('household_size').notNull().default(1),
  scheduleProfile: jsonb('schedule_profile').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
