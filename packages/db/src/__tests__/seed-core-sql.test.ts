// Real-Postgres test for the catalog seed's upsert: which rows a re-seed touches.
//
// Every deploy runs the seed (scripts/post-deploy.sh), so an unchanged catalog
// must leave every row alone. That behaviour lives in the ON CONFLICT WHERE
// clause, which seed-core.test.ts's mock can only record, not execute.

import { describe, test, expect, afterAll, beforeAll } from 'vitest';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { eq, like } from 'drizzle-orm';
import { createDb } from '../connection.js';
import { acquireDbTestLock, type DbTestLock } from '../test-lock.js';
import { assertTestDbUrl } from '../test-db-url.js';
import { ingredients } from '../schema/index.js';
import { seedDatabase, type IngredientSeedRow } from '../seed-core.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// SAFETY: same guard as the api suite — the database name must end in `_test`.
if (TEST_DB_URL) assertTestDbUrl(TEST_DB_URL);

const hasDb = Boolean(TEST_DB_URL);
const db = hasDb ? createDb(TEST_DB_URL!) : null;

const PREFIX = 'seed-sql-test';
const NAME = `${PREFIX}-potato`;

const row: IngredientSeedRow = {
  name: NAME,
  aliases: ['peruna'],
  category: 'produce',
  defaultUnit: 'g',
  nutritionPer100g: { kcal: 77, protein: 2 },
  shelfLife: { pantry_days: 30 },
  tags: ['root'],
  isStaple: false,
};

async function stored() {
  const [found] = await db!.select().from(ingredients).where(eq(ingredients.name, NAME));
  return found!;
}

let suiteLock: DbTestLock | null = null;

beforeAll(async () => {
  if (hasDb) suiteLock = await acquireDbTestLock(TEST_DB_URL!);
  await db?.delete(ingredients).where(like(ingredients.name, `${PREFIX}%`));
}, 130_000);

afterAll(async () => {
  if (db) {
    await db.delete(ingredients).where(like(ingredients.name, `${PREFIX}%`));
    await db.$client.end();
  }
  await suiteLock?.release();
});

describe.skipIf(!hasDb).sequential('seedDatabase re-seed', () => {
  test('counts a new row as changed', async () => {
    const result = await seedDatabase(db!, [row]);
    expect(result).toMatchObject({ ingredientCount: 1, ingredientsChanged: 1 });
  });

  test('an unchanged row is not touched, whatever its jsonb key order', async () => {
    const before = await stored();

    const result = await seedDatabase(db!, [
      { ...row, nutritionPer100g: { protein: 2, kcal: 77 } },
    ]);

    expect(result).toMatchObject({ ingredientCount: 1, ingredientsChanged: 0 });
    expect((await stored()).updatedAt).toEqual(before.updatedAt);
  });

  test('a changed row refreshes, and a curated isStaple survives', async () => {
    await db!.update(ingredients).set({ isStaple: true }).where(eq(ingredients.name, NAME));
    const before = await stored();

    const result = await seedDatabase(db!, [{ ...row, aliases: ['peruna', 'pottu'] }]);

    const after = await stored();
    expect(result).toMatchObject({ ingredientCount: 1, ingredientsChanged: 1 });
    expect(after.aliases).toEqual(['peruna', 'pottu']);
    expect(after.isStaple).toBe(true);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  test('a change to a null-able catalog column counts too', async () => {
    const result = await seedDatabase(db!, [{ ...row, aliases: null }]);
    expect(result).toMatchObject({ ingredientsChanged: 1 });

    const again = await seedDatabase(db!, [{ ...row, aliases: null }]);
    expect(again).toMatchObject({ ingredientsChanged: 0 });
  });
});
