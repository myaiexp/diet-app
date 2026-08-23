// Row-mapping and batching tests for the S-kaupat product import. Upsert
// behaviour against real SQL is covered by the integration suite; these pin
// the mapping decisions and the 500-row insert split that are easy to regress.

import { describe, test, expect } from 'vitest';
import { importProducts, toProductRow } from '../import-products.js';
import type { ExportedProduct } from '../import-products.js';
import type { Db } from '../connection.js';

const lime: ExportedProduct = {
  ean: '2000507900009',
  sokId: '100014744',
  name: 'Lime',
  brandName: null,
  slug: 'lime',
  price: 0.37,
  priceUnit: 'KPL',
  comparisonPrice: 3.89,
  comparisonUnit: 'KGM',
  countryOfOrigin: 'Brasilia',
  ingredientStatement: null,
  frozen: false,
  nutrients: [{ name: 'Energia', value: '126 kJ / 30 kcal' }],
  hierarchyPath: [
    { name: 'Limet', slug: 'hedelmat-ja-vihannekset/hedelmat/limet' },
    { name: 'Hedelmät', slug: 'hedelmat-ja-vihannekset/hedelmat' },
    { name: 'Hedelmät ja vihannekset', slug: 'hedelmat-ja-vihannekset' },
  ],
};

describe('toProductRow', () => {
  test('carries the store id so two stores can hold the same ean', () => {
    expect(toProductRow(lime, '660919473').storeId).toBe('660919473');
    expect(toProductRow(lime, '513971200').storeId).toBe('513971200');
  });

  // numeric columns take strings in Drizzle; a JS number round-trips lossily.
  test('renders prices as strings for the numeric columns', () => {
    const row = toProductRow(lime, '660919473');
    expect(row.price).toBe('0.37');
    expect(row.comparisonPrice).toBe('3.89');
  });

  test('keeps a null price null rather than coercing it to zero', () => {
    const row = toProductRow({ ...lime, price: null, comparisonPrice: undefined }, 'S');
    expect(row.price).toBeNull();
    expect(row.comparisonPrice).toBeNull();
  });

  // Stored outermost-first so a prefix match reads as a category filter.
  test('reverses hierarchyPath to outermost-first slugs', () => {
    expect(toProductRow(lime, 'S').categoryPath).toEqual([
      'hedelmat-ja-vihannekset',
      'hedelmat-ja-vihannekset/hedelmat',
      'hedelmat-ja-vihannekset/hedelmat/limet',
    ]);
  });

  test('tolerates a missing hierarchyPath', () => {
    expect(toProductRow({ ...lime, hierarchyPath: null }, 'S').categoryPath).toEqual([]);
  });

  test('parses nutrients into the jsonb column', () => {
    expect(toProductRow(lime, 'S').nutritionPer100g).toEqual({ calories: 30, energy_kj: 126 });
  });

  test('stores null nutrition for a product that declares none', () => {
    expect(toProductRow({ ...lime, nutrients: null }, 'S').nutritionPer100g).toBeNull();
  });

  test('defaults frozen to false when absent', () => {
    expect(toProductRow({ ...lime, frozen: undefined }, 'S').frozen).toBe(false);
  });
});

/** Records each insert().values() payload. The SQL suite owns ON CONFLICT. */
function makeInsertMock(): { db: Db; batches: unknown[][] } {
  const batches: unknown[][] = [];
  const db = {
    insert: () => ({
      values: (rows: unknown[]) => {
        batches.push(rows);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  };
  return { db: db as unknown as Db, batches };
}

describe('importProducts', () => {
  test('splits inserts at 500 rows so a 501-item dump is two statements', async () => {
    const { db, batches } = makeInsertMock();
    const items = Array.from({ length: 501 }, (_, i) => ({
      ...lime,
      ean: String(2_000_000_000_000 + i),
      name: `Item ${i}`,
    }));
    const result = await importProducts(db, items, 'S');
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toHaveLength(1);
    expect(result.imported).toBe(501);
    expect(result.skipped).toBe(0);
  });

  test('skips items missing ean or name without inserting them', async () => {
    const { db, batches } = makeInsertMock();
    const result = await importProducts(
      db,
      [
        { ...lime, ean: '', name: 'No ean' },
        { ...lime, ean: '1', name: '' },
        { ...lime, ean: '2', name: 'Ok' },
        { ...lime, ean: undefined as unknown as string, name: 'also no ean' },
      ],
      'S',
    );
    expect(result.skipped).toBe(3);
    expect(result.imported).toBe(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect((batches[0]![0] as { ean: string }).ean).toBe('2');
  });

  test('does not insert when every item is skipped', async () => {
    const { db, batches } = makeInsertMock();
    const result = await importProducts(
      db,
      [
        { name: 'x' } as ExportedProduct,
        { ean: '1' } as ExportedProduct,
      ],
      'S',
    );
    expect(result.skipped).toBe(2);
    expect(result.imported).toBe(0);
    expect(batches).toHaveLength(0);
  });
});
