// Mock-based route tests for profileRoutes — GET disliked ids + PATCH.

import { describe, test, expect, vi } from 'vitest';
import { profileRoutes } from '../routes/profile.js';

const PROFILE_ID = '11111111-1111-1111-1111-111111111111';
const ING_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ING_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ING_UNKNOWN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const PROFILE = {
  id: PROFILE_ID,
  name: 'Mase',
  calorieTargetMin: 2000,
  calorieTargetMax: 2400,
  macroTargets: null,
  dietaryRestrictions: [] as string[],
  cookingSkill: 'competent',
  kitchenEquipment: [] as string[],
  householdSize: 1,
  scheduleProfile: {},
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

type MockOpts = {
  profile?: typeof PROFILE | null | (() => typeof PROFILE | null | undefined);
  /** Rows returned by loadDislikedIds (and after-patch load when afterDislikedIds omitted). */
  dislikedIds?: string[];
  /** When PATCH includes dislikedIngredientIds: first select is ingredient existence check. */
  hasDislikedKey?: boolean;
  /** Ingredient ids found by the existence pre-check. */
  ingredientIds?: string[];
  /** Junction ids returned after a disliked PATCH write. */
  afterDislikedIds?: string[];
  throwOnWrite?: unknown;
};

function makeProfileMock(opts: MockOpts = {}) {
  const dislikedIds = opts.dislikedIds ?? [];
  const afterDislikedIds = opts.afterDislikedIds ?? dislikedIds;
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const deleteCalls: unknown[] = [];
  let selectCall = 0;

  const resolveProfile = () => {
    if (typeof opts.profile === 'function') return opts.profile();
    if (opts.profile === undefined) return PROFILE;
    return opts.profile;
  };

  const selectBuilder: any = {
    from: () => selectBuilder,
    where: () => {
      selectCall += 1;
      // PATCH with dislikedIngredientIds: call 1 = ingredient existence, rest = junction.
      const isIngredientCheck = opts.hasDislikedKey === true && selectCall === 1;
      const result = isIngredientCheck
        ? (opts.ingredientIds ?? []).map((id) => ({ id }))
        : (opts.hasDislikedKey && selectCall > 1 ? afterDislikedIds : dislikedIds).map(
            (id) => ({ ingredientId: id }),
          );
      return {
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      };
    },
  };

  const updateBuilder: any = {
    set: (v: unknown) => {
      updateSets.push(v);
      return updateBuilder;
    },
    where: () => updateBuilder,
  };

  const deleteBuilder: any = {
    where: (w: unknown) => {
      deleteCalls.push(w);
      return deleteBuilder;
    },
  };

  const insertBuilder: any = {
    values: (v: unknown) => {
      insertValues.push(v);
      return insertBuilder;
    },
  };

  const tx = {
    update: () => updateBuilder,
    delete: () => deleteBuilder,
    insert: () => insertBuilder,
  };

  const db = {
    query: {
      userProfile: {
        findFirst: vi.fn(async () => resolveProfile()),
      },
    },
    select: () => selectBuilder,
    update: () => updateBuilder,
    delete: () => deleteBuilder,
    insert: () => insertBuilder,
    transaction: async (fn: (t: typeof tx) => Promise<void>) => {
      if (opts.throwOnWrite) throw opts.throwOnWrite;
      await fn(tx);
    },
  } as any;

  return { db, insertValues, updateSets, deleteCalls };
}

describe('profileRoutes', () => {
  test('GET includes dislikedIngredientIds from junction', async () => {
    const { db } = makeProfileMock({ dislikedIds: [ING_B, ING_A] });
    const app = profileRoutes(db);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(PROFILE_ID);
    expect(body.dislikedIngredientIds).toEqual([ING_A, ING_B]); // sorted
  });

  test('GET 404 when no profile', async () => {
    const { db } = makeProfileMock({ profile: null });
    const app = profileRoutes(db);
    const res = await app.request('/');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('PATCH updates name and householdSize', async () => {
    const { db, updateSets } = makeProfileMock();
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Marcus', householdSize: 2 }),
    });
    expect(res.status).toBe(200);
    expect(updateSets[0]).toMatchObject({ name: 'Marcus', householdSize: 2 });
    const body = await res.json();
    expect(body.dislikedIngredientIds).toEqual([]);
  });

  test('PATCH null clears calorieTargetMin', async () => {
    const { db, updateSets } = makeProfileMock();
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calorieTargetMin: null }),
    });
    expect(res.status).toBe(200);
    expect(updateSets[0]).toMatchObject({ calorieTargetMin: null });
  });

  test('PATCH null on name returns 400', async () => {
    const { db } = makeProfileMock();
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: null }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Validation failed' });
  });

  test('PATCH empty body returns 400 Empty patch body', async () => {
    const { db } = makeProfileMock();
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.formErrors).toContain('Empty patch body');
  });

  test('PATCH calorie min > max after merge returns 400', async () => {
    const { db } = makeProfileMock();
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calorieTargetMin: 3000 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Validation failed' });
  });

  test('PATCH dislikedIngredientIds full replace', async () => {
    const { db, insertValues, deleteCalls } = makeProfileMock({
      hasDislikedKey: true,
      ingredientIds: [ING_A, ING_B],
      afterDislikedIds: [ING_A, ING_B],
      dislikedIds: [],
    });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dislikedIngredientIds: [ING_A, ING_B] }),
    });
    expect(res.status).toBe(200);
    expect(deleteCalls.length).toBe(1);
    expect(insertValues[0]).toEqual([
      { userId: PROFILE_ID, ingredientId: ING_A },
      { userId: PROFILE_ID, ingredientId: ING_B },
    ]);
    const body = await res.json();
    expect(body.dislikedIngredientIds).toEqual([ING_A, ING_B]);
  });

  test('PATCH dislikedIngredientIds empty array clears all', async () => {
    const { db, insertValues, deleteCalls } = makeProfileMock({
      hasDislikedKey: true,
      ingredientIds: [],
      afterDislikedIds: [],
      dislikedIds: [ING_A],
    });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dislikedIngredientIds: [] }),
    });
    expect(res.status).toBe(200);
    expect(deleteCalls.length).toBe(1);
    expect(insertValues).toHaveLength(0);
    expect((await res.json()).dislikedIngredientIds).toEqual([]);
  });

  test('PATCH dislikedIngredientIds dedupes duplicates', async () => {
    const { db, insertValues } = makeProfileMock({
      hasDislikedKey: true,
      ingredientIds: [ING_A],
      afterDislikedIds: [ING_A],
    });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dislikedIngredientIds: [ING_A, ING_A, ING_A] }),
    });
    expect(res.status).toBe(200);
    expect(insertValues[0]).toEqual([{ userId: PROFILE_ID, ingredientId: ING_A }]);
  });

  test('PATCH unknown ingredient id returns 400 Invalid reference', async () => {
    const { db } = makeProfileMock({
      hasDislikedKey: true,
      ingredientIds: [],
    });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dislikedIngredientIds: [ING_UNKNOWN] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
  });

  test('PATCH 404 when no profile', async () => {
    const { db } = makeProfileMock({ profile: null });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(404);
  });
});
