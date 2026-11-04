// Mock-based route tests for mealPlansRoutes: week GET and POST create paths.

import { describe, test, expect } from 'vitest';
import { asc } from 'drizzle-orm';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { mealPlanEntries } from '@diet-app/db';
import { makeSelectMock, pgError } from './db-mock.js';
import {
  ENTRIES,
  FREEFORM_ENTRY,
  PLANNED_ENTRY,
  RECIPE_ID,
  jsonReq,
  makeWriteMock,
} from './meal-plans-test-helpers.js';

describe('mealPlansRoutes', () => {
  test('GET /week/:date returns the week entries with date/slot/status', async () => {
    const app = mealPlansRoutes(makeSelectMock(ENTRIES).db);
    const res = await app.request('/week/2026-03-05');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    for (const entry of body) {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('slot');
      expect(entry).toHaveProperty('status');
    }
    expect(body.map((e: { slot: string }) => e.slot)).toEqual(['dinner', 'lunch']);
  });

  // The week is bounded so paging can't skip rows here, but two GETs of the
  // same week must not return the entries in different orders (finding #5450's
  // class). Slot order is left to the client — sorting `slot` as text would
  // read breakfast/dinner/lunch/snack.
  test('GET /week/:date orders chronologically with an id tie-break', async () => {
    const { db, calls } = makeSelectMock(ENTRIES);
    await mealPlansRoutes(db).request('/week/2026-03-05');
    expect(calls.orderBy).toEqual([asc(mealPlanEntries.date), asc(mealPlanEntries.id)]);
  });

  test('GET /week/:date returns an empty array for a week with no entries', async () => {
    const app = mealPlansRoutes(makeSelectMock([]).db);
    const res = await app.request('/week/2026-03-05');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('GET /week/:date returns 400 for a malformed date without touching the db', async () => {
    let queried = false;
    const db = {
      select: () => {
        queried = true;
        return { from: () => ({ where: async () => [] }) };
      },
    } as any;
    const app = mealPlansRoutes(db);
    for (const bad of ['foo', '2026-02-30', '2026-13-01', '03-05-2026']) {
      const res = await app.request(`/week/${bad}`);
      expect(res.status, `expected 400 for "${bad}"`).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid date format' });
    }
    expect(queried).toBe(false);
  });

  test('POST creates an entry', async () => {
    const { db, inserts } = makeWriteMock({
      insertRow: {
        ...PLANNED_ENTRY,
        date: '2026-07-21',
        slot: 'lunch',
        status: 'planned',
        servings: '2',
      },
    });
    const res = await mealPlansRoutes(db).request(
      '/',
      jsonReq('POST', '/', {
        date: '2026-07-21',
        slot: 'lunch',
        recipeId: RECIPE_ID,
        servings: 2,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.date).toBe('2026-07-21');
    expect(body.slot).toBe('lunch');
    expect(body.status).toBe('planned');
    expect(inserts[0]).toMatchObject({
      date: '2026-07-21',
      slot: 'lunch',
      recipeId: RECIPE_ID,
      servings: '2',
      status: 'planned',
    });
  });

  test('POST rejects an entry with neither recipeId nor freeformNote', async () => {
    const { db, inserts } = makeWriteMock();
    const res = await mealPlansRoutes(db).request(
      '/',
      jsonReq('POST', '/', { date: '2026-07-21', slot: 'dinner' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
    expect(inserts).toHaveLength(0);
  });

  // Same hasContent rule as PATCH: cook/shopping resolve
  // substituteRecipeId ?? recipeId, so a substitute-only create (demo Friday
  // dinner) is content. The create refine used to ignore that column and 400.
  test('POST creates a substitute-only entry (recipeId and note null)', async () => {
    const { db, inserts } = makeWriteMock({
      insertRow: {
        ...PLANNED_ENTRY,
        recipeId: null,
        freeformNote: null,
        substituteRecipeId: RECIPE_ID,
        status: 'substituted',
      },
    });
    const res = await mealPlansRoutes(db).request(
      '/',
      jsonReq('POST', '/', {
        date: '2026-07-21',
        slot: 'dinner',
        substituteRecipeId: RECIPE_ID,
        status: 'substituted',
      }),
    );
    expect(res.status).toBe(201);
    expect(inserts[0]).toMatchObject({
      recipeId: null,
      freeformNote: null,
      substituteRecipeId: RECIPE_ID,
      status: 'substituted',
    });
  });

  test('POST rejects an unknown slot', async () => {
    const { db } = makeWriteMock();
    const res = await mealPlansRoutes(db).request(
      '/',
      jsonReq('POST', '/', {
        date: '2026-07-21',
        slot: 'brunch',
        freeformNote: 'x',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
  });

  test('POST rejects status cooked (owned by cook endpoint)', async () => {
    const { db, inserts } = makeWriteMock();
    const res = await mealPlansRoutes(db).request(
      '/',
      jsonReq('POST', '/', {
        date: '2026-07-21',
        slot: 'dinner',
        freeformNote: 'x',
        status: 'cooked',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
    expect(inserts).toHaveLength(0);
  });

  test('POST creates a freeform entry without recipeId', async () => {
    const { db, inserts } = makeWriteMock({
      insertRow: { ...FREEFORM_ENTRY, freeformNote: 'lunch out' },
    });
    const res = await mealPlansRoutes(db).request(
      '/',
      jsonReq('POST', '/', {
        date: '2026-07-21',
        slot: 'lunch',
        freeformNote: 'lunch out',
      }),
    );
    expect(res.status).toBe(201);
    expect(inserts[0]).toMatchObject({ freeformNote: 'lunch out', recipeId: null });
  });

  test('POST maps an FK violation (23503) to 400 Invalid reference', async () => {
    // The recipe is gone by the time the insert lands — the only signal is the
    // driver error, so a predicate that stops recognising it turns this into a 500.
    const { db, inserts } = makeWriteMock({ throwOnWrite: pgError('23503') });
    const res = await mealPlansRoutes(db).request(
      '/',
      jsonReq('POST', '/', {
        date: '2026-07-21',
        slot: 'dinner',
        recipeId: RECIPE_ID,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
    expect(inserts).toHaveLength(1); // attempted, then mapped — not skipped
  });

  test('POST lets a non-FK database error escape as a 500', async () => {
    const { db } = makeWriteMock({ throwOnWrite: pgError('08006') });
    const res = await mealPlansRoutes(db).request(
      '/',
      jsonReq('POST', '/', { date: '2026-07-21', slot: 'dinner', recipeId: RECIPE_ID }),
    );
    expect(res.status).toBe(500);
  });
});
