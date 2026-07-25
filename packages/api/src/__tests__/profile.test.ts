// Mock-based route tests for profileRoutes — GET disliked ids + PATCH.

import { describe, test, expect, vi } from 'vitest';
import { ingredients, userDislikedIngredients } from '@diet-app/db';
import { profileRoutes } from '../routes/profile.js';
import { makeDbMock, pgError } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';

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
  /** Junction rows loadDislikedIds reads (GET, and PATCH when unchanged). */
  dislikedIds?: string[];
  /** Ingredient ids the existence pre-check finds. */
  ingredientIds?: string[];
  /** Junction ids the post-write reload returns; defaults to dislikedIds. */
  afterDislikedIds?: string[];
  /** Driver-shaped error thrown at the handler's write (FK races). */
  throwOnWrite?: unknown;
};

function makeWriteMock(opts: MockOpts = {}) {
  const dislikedIds = opts.dislikedIds ?? [];
  const afterDislikedIds = opts.afterDislikedIds ?? dislikedIds;

  const resolveProfile = () => {
    if (typeof opts.profile === 'function') return opts.profile();
    if (opts.profile === undefined) return PROFILE;
    return opts.profile;
  };

  return makeDbMock({
    // The two reads hit different tables: ingredients is the existence
    // pre-check for a disliked patch, user_disliked_ingredients is the junction
    // load that builds the response (always after the write on PATCH).
    select: makeSelectRouter([
      [ingredients, (opts.ingredientIds ?? []).map((id) => ({ id }))],
      [userDislikedIngredients, afterDislikedIds.map((id) => ({ ingredientId: id }))],
    ]).select,
    query: {
      userProfile: {
        findFirst: vi.fn(async () => resolveProfile()),
      },
    },
    throwOnWrite: () => opts.throwOnWrite,
  });
}

describe('profileRoutes', () => {
  test('GET includes dislikedIngredientIds from junction', async () => {
    const { db } = makeWriteMock({ dislikedIds: [ING_B, ING_A] });
    const app = profileRoutes(db);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(PROFILE_ID);
    expect(body.dislikedIngredientIds).toEqual([ING_A, ING_B]); // sorted
  });

  test('GET 404 when no profile', async () => {
    const { db } = makeWriteMock({ profile: null });
    const app = profileRoutes(db);
    const res = await app.request('/');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('PATCH updates name and householdSize', async () => {
    const { db, updates } = makeWriteMock();
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Marcus', householdSize: 2 }),
    });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ name: 'Marcus', householdSize: 2 });
    const body = await res.json();
    expect(body.dislikedIngredientIds).toEqual([]);
  });

  test('PATCH null clears calorieTargetMin', async () => {
    const { db, updates } = makeWriteMock();
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calorieTargetMin: null }),
    });
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ calorieTargetMin: null });
  });

  test('PATCH null on name returns 400', async () => {
    const { db } = makeWriteMock();
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
    const { db } = makeWriteMock();
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
    const { db } = makeWriteMock();
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
    const { db, inserts, deletes } = makeWriteMock({
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
    expect(deletes.length).toBe(1);
    expect(inserts[0]).toEqual([
      { userId: PROFILE_ID, ingredientId: ING_A },
      { userId: PROFILE_ID, ingredientId: ING_B },
    ]);
    const body = await res.json();
    expect(body.dislikedIngredientIds).toEqual([ING_A, ING_B]);
  });

  test('PATCH dislikedIngredientIds empty array clears all', async () => {
    const { db, inserts, deletes } = makeWriteMock({
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
    expect(deletes.length).toBe(1);
    expect(inserts).toHaveLength(0);
    expect((await res.json()).dislikedIngredientIds).toEqual([]);
  });

  test('PATCH dislikedIngredientIds dedupes duplicates', async () => {
    const { db, inserts } = makeWriteMock({
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
    expect(inserts[0]).toEqual([{ userId: PROFILE_ID, ingredientId: ING_A }]);
  });

  test('PATCH unknown ingredient id returns 400 Invalid reference', async () => {
    const { db } = makeWriteMock({
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

  test('PATCH maps an FK violation (23503) to 400 Invalid reference', async () => {
    // The ingredient existence pre-check passed, then the row was deleted before
    // the junction insert landed. Same 400 as the pre-check, not a 500.
    const { db, inserts } = makeWriteMock({
      ingredientIds: [ING_A],
      throwOnWrite: pgError('23503'),
    });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dislikedIngredientIds: [ING_A] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
    expect(inserts).toHaveLength(0); // failed at the profile update, before the junction insert
  });

  test('PATCH maps an FK violation on the plain (no-junction) update too', async () => {
    // A body without dislikedIngredientIds skips the transaction entirely and
    // updates directly — a separate write path reaching the same catch.
    const { db } = makeWriteMock({ throwOnWrite: pgError('23503') });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Marcus' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
  });

  test('PATCH lets a non-FK database error escape as a 500', async () => {
    const { db } = makeWriteMock({ throwOnWrite: pgError('23502') });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Marcus' }),
    });
    expect(res.status).toBe(500);
  });

  test('PATCH 404 when no profile', async () => {
    const { db } = makeWriteMock({ profile: null });
    const app = profileRoutes(db);
    const res = await app.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(404);
  });
});
