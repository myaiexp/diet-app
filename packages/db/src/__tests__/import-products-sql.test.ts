// Real-Postgres test for the product import's upsert semantics.
//
// The mapping tests in import-products.test.ts prove what a row LOOKS like; only
// real SQL proves that a second import updates in place instead of duplicating,
// because that behaviour lives entirely in ON CONFLICT (store_id, ean) — a mock
// would just record that .onConflictDoUpdate() was called.

import { describe, test, expect, afterAll } from 'vitest';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb } from '../connection.js';
import { products } from '../schema/index.js';
import { importProducts, type ExportedProduct } from '../import-products.js';

// vitest does not load the repo-root .env, so the suite reads it the same way
// the api integration suite does — otherwise the gate below fires spuriously.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// SAFETY: mirrors the api suite's guard — never let this point at production.
if (TEST_DB_URL && TEST_DB_URL.includes('dietapp') && !TEST_DB_URL.includes('_test')) {
  throw new Error(
    "Refusing to run tests: TEST_DATABASE_URL looks like the production database " +
      "(contains 'dietapp' but not '_test'). Point it at dietapp_test before running tests.",
  );
}

const hasDb = Boolean(TEST_DB_URL);
const db = hasDb ? createDb(TEST_DB_URL!) : null;
const SKIP_DB_TESTS = process.env.DIET_APP_SKIP_DB_TESTS === '1';

// Namespaced so a failed run cannot collide with real data or another suite.
const STORE_A = 'test-store-a';
const STORE_B = 'test-store-b';
const EAN = '9990000000001';

const base: ExportedProduct = {
  ean: EAN,
  sokId: '1',
  name: 'Testituote',
  price: 1.5,
  priceUnit: 'KPL',
  nutrients: [{ name: 'Energia', value: '196 kJ / 47 kcal' }],
  hierarchyPath: [{ name: 'Maito', slug: 'maito-munat-ja-rasvat/maidot' }],
};

describe('integration DB gate', () => {
  test.skipIf(SKIP_DB_TESTS)('TEST_DATABASE_URL is configured', () => {
    expect(
      hasDb,
      'TEST_DATABASE_URL is not set, so the real-Postgres upsert test would skip ' +
        'silently — and upsert behaviour has no other cover. Provision with ' +
        '`pnpm --filter @diet-app/db setup:test-db`. To run mock suites without ' +
        'Postgres on purpose, set DIET_APP_SKIP_DB_TESTS=1.',
    ).toBe(true);
  });
});

afterAll(async () => {
  if (!db) return;
  await db.delete(products).where(inArray(products.storeId, [STORE_A, STORE_B]));
  await db.$client.end();
});

describe.skipIf(!hasDb)('importProducts against real SQL', () => {
  test('a second import updates in place instead of duplicating', async () => {
    await importProducts(db!, [base], STORE_A);
    await importProducts(db!, [{ ...base, price: 2.25, name: 'Testituote uusi' }], STORE_A);

    const rows = await db!
      .select()
      .from(products)
      .where(and(eq(products.storeId, STORE_A), eq(products.ean, EAN)));

    expect(rows).toHaveLength(1);
    // numeric reads back as a string — compare as one rather than ==-ing a number.
    expect(rows[0]!.price).toBe('2.25');
    expect(rows[0]!.name).toBe('Testituote uusi');
  });

  // The whole reason the unique key is composite: keying on ean alone would make
  // a second store's import silently overwrite the first store's prices.
  test('the same ean coexists across two stores with different prices', async () => {
    await importProducts(db!, [base], STORE_A);
    await importProducts(db!, [{ ...base, price: 9.99 }], STORE_B);

    const rows = await db!
      .select()
      .from(products)
      .where(inArray(products.storeId, [STORE_A, STORE_B]));

    expect(rows).toHaveLength(2);
    // numeric with no declared scale preserves what was written, so 1.5 reads back
    // as '1.5' and not '1.50' — display formatting is the caller's job, not the DB's.
    expect(rows.find((r) => r.storeId === STORE_A)!.price).toBe('1.5');
    expect(rows.find((r) => r.storeId === STORE_B)!.price).toBe('9.99');
  });

  test('parsed nutrition survives the jsonb round trip', async () => {
    await importProducts(db!, [base], STORE_A);
    const [row] = await db!
      .select()
      .from(products)
      .where(and(eq(products.storeId, STORE_A), eq(products.ean, EAN)));
    expect(row!.nutritionPer100g).toEqual({ calories: 47, energy_kj: 196 });
  });

  test('a row without an ean is skipped rather than written', async () => {
    const result = await importProducts(
      db!,
      [base, { ...base, ean: '' } as ExportedProduct],
      STORE_A,
    );
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(1);
  });
});
