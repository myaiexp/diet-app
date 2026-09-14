// Maps an S-kaupat store export onto product rows and upserts them

import { sql } from 'drizzle-orm';
import { products } from './schema/index.js';
import type { Db } from './connection.js';
import { parseNutrients, type RawNutrient } from './nutrients.js';
import { excludedColumns } from './upsert.js';

/** One item as `scripts/skaupat-export.py` writes it. */
export interface ExportedProduct {
  ean: string;
  sokId?: string | null;
  name: string;
  brandName?: string | null;
  slug?: string | null;
  price?: number | null;
  priceUnit?: string | null;
  comparisonPrice?: number | null;
  comparisonUnit?: string | null;
  countryOfOrigin?: string | null;
  ingredientStatement?: string | null;
  frozen?: boolean | null;
  nutrients?: RawNutrient[] | null;
  hierarchyPath?: { name: string; slug: string }[] | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  withNutrition: number;
  /** Nutrient names outside the known vocabulary, with counts — upstream drift. */
  unknownNutrients: Record<string, number>;
  /** Known nutrients whose value could not be parsed; never written as 0. */
  unparseableValues: number;
}

type ProductRow = typeof products.$inferInsert;

/**
 * hierarchyPath arrives innermost-first ("Limet", "Hedelmät", "Hedelmät ja
 * vihannekset"); store it outermost-first so a prefix match is a category filter.
 */
function categoryPath(item: ExportedProduct): string[] {
  return [...(item.hierarchyPath ?? [])].reverse().map((h) => h.slug);
}

/** numeric columns take strings; passing a JS number loses precision on the way in. */
function money(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function toProductRow(item: ExportedProduct, storeId: string): ProductRow {
  return {
    ean: item.ean,
    sokId: item.sokId ?? null,
    storeId,
    name: item.name,
    brandName: item.brandName ?? null,
    slug: item.slug ?? null,
    price: money(item.price),
    priceUnit: item.priceUnit ?? null,
    comparisonPrice: money(item.comparisonPrice),
    comparisonUnit: item.comparisonUnit ?? null,
    countryOfOrigin: item.countryOfOrigin ?? null,
    ingredientStatement: item.ingredientStatement ?? null,
    nutritionPer100g: parseNutrients(item.nutrients).nutrition,
    categoryPath: categoryPath(item),
    frozen: item.frozen ?? false,
  };
}

// Postgres caps a statement at 65535 bind parameters; ~17 columns per row means
// batches must stay well under that. 500 rows ≈ 8.5k params, comfortably inside.
const BATCH_SIZE = 500;

/**
 * Upserts on the (store_id, ean) natural key so a re-import refreshes prices in
 * place rather than duplicating the assortment. `fetchedAt` is bumped on every
 * write so a stale row is identifiable; `createdAt` deliberately is not.
 *
 * Rows without an `ean` are skipped and counted — the key cannot be synthesised,
 * and inventing one would create a row no later import can ever match again.
 */
export async function importProducts(
  db: Db,
  items: ExportedProduct[],
  storeId: string,
): Promise<ImportResult> {
  const unknownNutrients: Record<string, number> = {};
  let unparseableValues = 0;
  let withNutrition = 0;
  let skipped = 0;

  const rows: ProductRow[] = [];
  for (const item of items) {
    if (!item?.ean || !item.name) {
      skipped++;
      continue;
    }
    const parsed = parseNutrients(item.nutrients);
    if (parsed.nutrition) withNutrition++;
    for (const name of parsed.unknownNames) {
      unknownNutrients[name] = (unknownNutrients[name] ?? 0) + 1;
    }
    unparseableValues += parsed.unparseable.length;
    rows.push(toProductRow(item, storeId));
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await db
      .insert(products)
      .values(rows.slice(i, i + BATCH_SIZE))
      .onConflictDoUpdate({
        target: [products.storeId, products.ean],
        set: {
          ...excludedColumns({
            sokId: products.sokId,
            name: products.name,
            brandName: products.brandName,
            slug: products.slug,
            price: products.price,
            priceUnit: products.priceUnit,
            comparisonPrice: products.comparisonPrice,
            comparisonUnit: products.comparisonUnit,
            countryOfOrigin: products.countryOfOrigin,
            ingredientStatement: products.ingredientStatement,
            nutritionPer100g: products.nutritionPer100g,
            categoryPath: products.categoryPath,
            frozen: products.frozen,
          }),
          fetchedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }

  return {
    imported: rows.length,
    skipped,
    withNutrition,
    unknownNutrients,
    unparseableValues,
  };
}
