import { pgTable, uuid, text, numeric, boolean, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Barcode. Store-internal codes for loose produce start with 2 and are only
    // meaningful within S-group — fine here, not a global identifier.
    ean: text('ean').notNull(),
    sokId: text('sok_id'),
    // Which store's assortment this row came from. Part of the natural key: the
    // same EAN carries a different price in a different store, so keying on ean
    // alone would make a second store's import silently overwrite the first's.
    storeId: text('store_id').notNull(),
    name: text('name').notNull(),
    brandName: text('brand_name'),
    slug: text('slug'),
    // Snapshot at fetchedAt, not a live price — this table is a catalog cache,
    // refreshed by re-import. numeric reads back as a string in JS.
    price: numeric('price'),
    priceUnit: text('price_unit'),
    comparisonPrice: numeric('comparison_price'),
    comparisonUnit: text('comparison_unit'),
    countryOfOrigin: text('country_of_origin'),
    ingredientStatement: text('ingredient_statement'),
    // Parsed from the API's Finnish nutrient strings (see nutrients.ts). Null when
    // the product declares none — 6,196 of 17,126 in a real store dump, mostly
    // non-food. Keys are absent rather than zero when a single nutrient is undeclared.
    nutritionPer100g: jsonb('nutrition_per_100g'),
    // hierarchyPath slugs, outermost category first.
    categoryPath: text('category_path').array().default([]),
    frozen: boolean('frozen').default(false),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('products_store_ean_unique').on(table.storeId, table.ean),
    // Lookups by barcode alone (order lines, a future scanner) don't know the store.
    index('products_ean_idx').on(table.ean),
  ],
);

// Relations are defined in schema/relations.ts to avoid circular imports
