// Row-mapping tests for the S-kaupat product import — the transform from an
// export item to a products row. Upsert behaviour against real SQL is covered by
// the integration suite; these pin the mapping decisions that are easy to regress.

import { describe, test, expect } from 'vitest';
import { toProductRow } from '../import-products.js';
import type { ExportedProduct } from '../import-products.js';

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
