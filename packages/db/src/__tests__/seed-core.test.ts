// Postgres-free unit tests for the seed core: env guard, profile branch,
// empty-input guard, transaction wrapping, and the upsert conflict target.

import { describe, test, expect } from 'vitest';
import {
  resolveConnectionString,
  seedDatabase,
  ingredients,
  userProfile,
  type IngredientSeedRow,
} from '../index.js';

// Chainable mock of a drizzle transaction that records what seedDatabase did,
// without ever opening a real connection.
function makeMockDb({ existingProfiles = [] as unknown[] } = {}) {
  const calls = {
    transactionOpened: false,
    ingredientUpsertRows: null as unknown[] | null,
    onConflictTarget: undefined as unknown,
    // The conflict-update SET map. Capturing only the target would leave the
    // "does a re-seed overwrite isPantryStaple" question unobservable — the
    // assertion below would pass whether or not the column is in the list.
    onConflictSet: undefined as Record<string, unknown> | undefined,
    profileInserted: false,
  };

  const tx = {
    insert(table: unknown) {
      return {
        values(rows: unknown) {
          if (table === userProfile) {
            calls.profileInserted = true;
            return Promise.resolve();
          }
          calls.ingredientUpsertRows = rows as unknown[];
          return {
            onConflictDoUpdate(arg: { target: unknown; set: Record<string, unknown> }) {
              calls.onConflictTarget = arg.target;
              calls.onConflictSet = arg.set;
              return Promise.resolve();
            },
          };
        },
      };
    },
    select() {
      return { from: () => ({ limit: () => Promise.resolve(existingProfiles) }) };
    },
  };

  const db = {
    async transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      calls.transactionOpened = true;
      return cb(tx);
    },
  } as unknown as Parameters<typeof seedDatabase>[0];

  return { db, calls };
}

const SAMPLE: IngredientSeedRow[] = [
  { name: 'potato', aliases: ['peruna'], category: 'produce', defaultUnit: 'g', nutritionPer100g: {}, shelfLife: {}, tags: [], isPantryStaple: true },
  { name: 'onion', aliases: ['sipuli'], category: 'produce', defaultUnit: 'g', nutritionPer100g: {}, shelfLife: {}, tags: [], isPantryStaple: false },
];

describe('resolveConnectionString', () => {
  test('returns the URL when set', () => {
    expect(resolveConnectionString({ DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv)).toBe(
      'postgres://x',
    );
  });

  test('throws when DATABASE_URL is missing', () => {
    expect(() => resolveConnectionString({} as NodeJS.ProcessEnv)).toThrow('DATABASE_URL not set');
  });
});

describe('seedDatabase', () => {
  test('upserts ingredients and creates a profile when none exists', async () => {
    const { db, calls } = makeMockDb({ existingProfiles: [] });
    const result = await seedDatabase(db, SAMPLE);

    expect(calls.transactionOpened).toBe(true);
    expect(calls.ingredientUpsertRows).toHaveLength(2);
    expect(calls.onConflictTarget).toBe(ingredients.name);
    expect(calls.profileInserted).toBe(true);
    expect(result).toEqual({ ingredientCount: 2, profileCreated: true });
  });

  test('skips profile creation when one already exists', async () => {
    const { db, calls } = makeMockDb({ existingProfiles: [{ id: 'x' }] });
    const result = await seedDatabase(db, SAMPLE);

    expect(calls.profileInserted).toBe(false);
    expect(result.profileCreated).toBe(false);
  });

  test('skips the ingredient insert when given an empty array', async () => {
    const { db, calls } = makeMockDb({ existingProfiles: [{ id: 'x' }] });
    const result = await seedDatabase(db, []);

    expect(calls.ingredientUpsertRows).toBeNull();
    expect(result.ingredientCount).toBe(0);
  });

  test('does not overwrite isPantryStaple on re-seed', async () => {
    // The flag is user-owned (PATCH /api/ingredients/:id). If it appeared in the
    // conflict-update set, every `pnpm db:seed` would reset the user's curation
    // back to the JSON guess.
    const { db, calls } = makeMockDb();
    await seedDatabase(db, SAMPLE);

    expect(Object.keys(calls.onConflictSet!)).not.toContain('isPantryStaple');
    // ...while the genuine catalog columns must keep refreshing.
    expect(Object.keys(calls.onConflictSet!)).toEqual(
      expect.arrayContaining([
        'aliases',
        'category',
        'defaultUnit',
        'nutritionPer100g',
        'shelfLife',
        'tags',
        'updatedAt',
      ]),
    );
  });

  test('still seeds isPantryStaple for a newly inserted ingredient', async () => {
    const { db, calls } = makeMockDb();
    await seedDatabase(db, SAMPLE);

    expect(calls.ingredientUpsertRows![0]).toMatchObject({
      name: 'potato',
      isPantryStaple: true,
    });
  });

  test('projects only known ingredient columns into the insert', async () => {
    const { db, calls } = makeMockDb();
    const withExtra = [{ ...SAMPLE[0], bogusColumn: 'nope' }] as unknown as IngredientSeedRow[];
    await seedDatabase(db, withExtra);

    expect(calls.ingredientUpsertRows![0]).not.toHaveProperty('bogusColumn');
    expect(calls.ingredientUpsertRows![0]).toMatchObject({ name: 'potato' });
  });
});
