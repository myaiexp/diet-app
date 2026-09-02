// Schema drift guard: asserts every table's column SET plus each column's
// resolved Drizzle constraints (type, notNull, default, PK, unique) and the
// real foreign-key wiring. A plain Object.keys().toContain() check only proves a
// JS property exists — it stays green if .notNull() is dropped, a default is
// removed, a type changes, or a .references() FK is deleted. These assertions
// fail on any of those.

import { describe, test, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import * as schema from '../schema/index.js';

type ColumnSpec = {
  type: string; // Drizzle columnType, e.g. 'PgUUID', 'PgText', 'PgDateString'
  notNull?: boolean;
  hasDefault?: boolean;
  primary?: boolean;
  unique?: boolean;
};

// Expected column shape per table — an independent declaration of the schema so
// drift (added/removed column, flipped constraint) surfaces as a test failure.
const COLUMN_SPECS: Record<string, Record<string, ColumnSpec>> = {
  ingredients: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    name: { type: 'PgText', notNull: true, unique: true },
    aliases: { type: 'PgArray', hasDefault: true },
    category: { type: 'PgText', notNull: true },
    defaultUnit: { type: 'PgText', notNull: true },
    nutritionPer100g: { type: 'PgJsonb', notNull: true },
    shelfLife: { type: 'PgJsonb', notNull: true },
    tags: { type: 'PgArray', hasDefault: true },
    isPantryStaple: { type: 'PgBoolean', hasDefault: true },
    createdAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    updatedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
  },
  products: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    // Uniqueness is the composite (store_id, ean), so neither column is unique alone.
    ean: { type: 'PgText', notNull: true },
    sokId: { type: 'PgText' },
    storeId: { type: 'PgText', notNull: true },
    name: { type: 'PgText', notNull: true },
    brandName: { type: 'PgText' },
    slug: { type: 'PgText' },
    price: { type: 'PgNumeric' },
    priceUnit: { type: 'PgText' },
    comparisonPrice: { type: 'PgNumeric' },
    comparisonUnit: { type: 'PgText' },
    countryOfOrigin: { type: 'PgText' },
    ingredientStatement: { type: 'PgText' },
    nutritionPer100g: { type: 'PgJsonb' },
    categoryPath: { type: 'PgArray', hasDefault: true },
    frozen: { type: 'PgBoolean', hasDefault: true },
    fetchedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    createdAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    updatedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
  },
  recipes: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    title: { type: 'PgText', notNull: true },
    sourceType: { type: 'PgText', notNull: true },
    sourceUrl: { type: 'PgText' },
    parentRecipeId: { type: 'PgUUID' },
    steps: { type: 'PgJsonb', notNull: true, hasDefault: true },
    prepTime: { type: 'PgInteger' },
    totalTime: { type: 'PgInteger' },
    servings: { type: 'PgInteger', notNull: true, hasDefault: true },
    effortScore: { type: 'PgInteger' },
    tags: { type: 'PgArray', hasDefault: true },
    cuisineType: { type: 'PgText' },
    userRating: { type: 'PgInteger' },
    timesCooked: { type: 'PgInteger', notNull: true, hasDefault: true },
    createdAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    updatedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
  },
  recipeIngredients: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    recipeId: { type: 'PgUUID', notNull: true },
    ingredientId: { type: 'PgUUID', notNull: true },
    quantity: { type: 'PgNumeric', notNull: true },
    unit: { type: 'PgText', notNull: true },
    optional: { type: 'PgBoolean', hasDefault: true },
    notes: { type: 'PgText' },
  },
  pantryItems: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    ingredientId: { type: 'PgUUID', notNull: true },
    quantity: { type: 'PgNumeric', notNull: true },
    unit: { type: 'PgText', notNull: true },
    location: { type: 'PgText', notNull: true },
    addedDate: { type: 'PgDateString', notNull: true },
    expiresDate: { type: 'PgDateString', notNull: true },
    opened: { type: 'PgBoolean', hasDefault: true },
    createdAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    updatedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
  },
  mealPlanEntries: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    date: { type: 'PgDateString', notNull: true },
    slot: { type: 'PgText', notNull: true },
    recipeId: { type: 'PgUUID' },
    freeformNote: { type: 'PgText' },
    servings: { type: 'PgNumeric', notNull: true, hasDefault: true },
    // Nullable and defaultless on purpose: only a cook writes it, so null is
    // "not cooked", not "cooked as planned".
    actualServings: { type: 'PgNumeric' },
    status: { type: 'PgText', notNull: true, hasDefault: true },
    substituteRecipeId: { type: 'PgUUID' },
    notes: { type: 'PgText' },
    createdAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    updatedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
  },
  cookFeedback: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    mealPlanEntryId: { type: 'PgUUID', notNull: true, unique: true },
    rating: { type: 'PgText', notNull: true },
    effortCheck: { type: 'PgText', notNull: true },
    makeAgain: { type: 'PgText', notNull: true },
    usedAsIs: { type: 'PgBoolean', notNull: true },
    changesNote: { type: 'PgText' },
    createdAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    updatedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
  },
  shoppingLists: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    weekStarting: { type: 'PgDateString', notNull: true },
    status: { type: 'PgText', notNull: true, hasDefault: true },
    createdAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    updatedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
  },
  shoppingListItems: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    listId: { type: 'PgUUID', notNull: true },
    ingredientId: { type: 'PgUUID', notNull: true },
    quantityNeeded: { type: 'PgNumeric', notNull: true },
    quantityInPantry: { type: 'PgNumeric', notNull: true, hasDefault: true },
    netToBuy: { type: 'PgNumeric', notNull: true },
    category: { type: 'PgText', notNull: true },
    // Base unit of the row's dimension; part of the (list, ingredient, unit)
    // unique index generation upserts on.
    unit: { type: 'PgText', notNull: true },
    source: { type: 'PgText', notNull: true, hasDefault: true },
    // notNull: the regeneration prune predicate (generated AND NOT bought)
    // would skip NULL rows.
    bought: { type: 'PgBoolean', notNull: true, hasDefault: true },
    customNote: { type: 'PgText' },
  },
  userProfile: {
    id: { type: 'PgUUID', notNull: true, hasDefault: true, primary: true },
    name: { type: 'PgText', notNull: true },
    calorieTargetMin: { type: 'PgInteger' },
    calorieTargetMax: { type: 'PgInteger' },
    macroTargets: { type: 'PgJsonb' },
    dietaryRestrictions: { type: 'PgArray', hasDefault: true },
    cookingSkill: { type: 'PgText', notNull: true, hasDefault: true },
    kitchenEquipment: { type: 'PgArray', hasDefault: true },
    householdSize: { type: 'PgInteger', notNull: true, hasDefault: true },
    scheduleProfile: { type: 'PgJsonb', notNull: true, hasDefault: true },
    createdAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
    updatedAt: { type: 'PgTimestamp', notNull: true, hasDefault: true },
  },
  // Junction table: composite PK (user_id, ingredient_id), so neither column
  // carries the column-level `primary` flag (that is set only by .primaryKey()).
  userDislikedIngredients: {
    userId: { type: 'PgUUID', notNull: true },
    ingredientId: { type: 'PgUUID', notNull: true },
  },
};

// Expected FK wiring. column/refColumn are DB names (snake_case); refTable
// is the referenced table's DB name (from getTableName).
const FK_SPECS = [
  { table: 'recipes', column: 'parent_recipe_id', refTable: 'recipes', refColumn: 'id' },
  { table: 'recipeIngredients', column: 'recipe_id', refTable: 'recipes', refColumn: 'id' },
  { table: 'recipeIngredients', column: 'ingredient_id', refTable: 'ingredients', refColumn: 'id' },
  { table: 'pantryItems', column: 'ingredient_id', refTable: 'ingredients', refColumn: 'id' },
  { table: 'mealPlanEntries', column: 'recipe_id', refTable: 'recipes', refColumn: 'id' },
  { table: 'mealPlanEntries', column: 'substitute_recipe_id', refTable: 'recipes', refColumn: 'id' },
  { table: 'cookFeedback', column: 'meal_plan_entry_id', refTable: 'meal_plan_entries', refColumn: 'id' },
  { table: 'shoppingListItems', column: 'list_id', refTable: 'shopping_lists', refColumn: 'id' },
  { table: 'shoppingListItems', column: 'ingredient_id', refTable: 'ingredients', refColumn: 'id' },
  { table: 'userDislikedIngredients', column: 'user_id', refTable: 'user_profile', refColumn: 'id' },
  { table: 'userDislikedIngredients', column: 'ingredient_id', refTable: 'ingredients', refColumn: 'id' },
];

// Drizzle exposes each column as an enumerable own property carrying a columnType.
function columnKeys(table: Record<string, unknown>): string[] {
  return Object.entries(table)
    .filter(([, v]) => v != null && typeof v === 'object' && 'columnType' in (v as object))
    .map(([k]) => k);
}

function expectColumn(table: Record<string, any>, name: string, spec: ColumnSpec) {
  const col = table[name];
  expect(col, `column "${name}" should exist`).toBeDefined();
  expect(col.columnType, `${name}.columnType`).toBe(spec.type);
  expect(col.notNull, `${name}.notNull`).toBe(spec.notNull ?? false);
  expect(col.hasDefault, `${name}.hasDefault`).toBe(spec.hasDefault ?? false);
  expect(col.primary, `${name}.primary`).toBe(spec.primary ?? false);
  expect(col.isUnique, `${name}.unique`).toBe(spec.unique ?? false);
}

// The FK reference declared on `localColumn`, or undefined if no FK is configured.
function fkFor(table: Record<string, any>, localColumn: string) {
  return getTableConfig(table as any)
    .foreignKeys.map((fk) => fk.reference())
    .find((ref) => ref.columns.some((c) => c.name === localColumn));
}

const tables = schema as Record<string, any>;

describe('schema columns & constraints', () => {
  for (const [tableName, cols] of Object.entries(COLUMN_SPECS)) {
    describe(tableName, () => {
      const table = tables[tableName];

      test('column set matches spec (no added/removed columns)', () => {
        expect(table, `table ${tableName} should be exported`).toBeDefined();
        expect(columnKeys(table).sort()).toEqual(Object.keys(cols).sort());
      });

      for (const [colName, spec] of Object.entries(cols)) {
        test(`${colName} is ${spec.type}`, () => {
          expectColumn(table, colName, spec);
        });
      }
    });
  }
});

describe('foreign keys', () => {
  test.each(FK_SPECS)(
    '$table.$column references $refTable.$refColumn',
    ({ table, column, refTable, refColumn }) => {
      const ref = fkFor(tables[table], column);
      expect(ref, `FK on ${table}.${column} should be configured`).toBeDefined();
      expect(getTableName(ref!.foreignTable)).toBe(refTable);
      expect(ref!.foreignColumns.map((c) => c.name)).toContain(refColumn);
    },
  );
});

describe('schema exports', () => {
  test('all tables exported from index', () => {
    for (const tableName of Object.keys(COLUMN_SPECS)) {
      expect(tables[tableName], `${tableName} should be exported`).toBeDefined();
    }
  });

  // Everything above loops COLUMN_SPECS, so a table added to the schema but not to
  // the spec map is covered by nothing and the whole file still passes. This is the
  // only assertion that reads the live schema, so it is what forces a new table to
  // arrive with a spec.
  test('every exported table has a COLUMN_SPECS entry', () => {
    const exported = Object.entries(tables)
      .filter(([, v]) => v != null && typeof v === 'object' && columnKeys(v).length > 0)
      .map(([k]) => k);
    expect(exported.sort()).toEqual(Object.keys(COLUMN_SPECS).sort());
  });

  test('all relations exported from index', () => {
    expect(schema.ingredientsRelations).toBeDefined();
    expect(schema.recipesRelations).toBeDefined();
    expect(schema.recipeIngredientsRelations).toBeDefined();
    expect(schema.pantryItemsRelations).toBeDefined();
    expect(schema.mealPlanEntriesRelations).toBeDefined();
    expect(schema.cookFeedbackRelations).toBeDefined();
    expect(schema.shoppingListsRelations).toBeDefined();
    expect(schema.shoppingListItemsRelations).toBeDefined();
    expect(schema.userProfileRelations).toBeDefined();
    expect(schema.userDislikedIngredientsRelations).toBeDefined();
  });
});
