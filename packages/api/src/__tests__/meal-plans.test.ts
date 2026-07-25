// Mock-based route tests for mealPlansRoutes — week GET + write paths

import { describe, test, expect, vi } from 'vitest';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { cookFeedback } from '@diet-app/db';
import { chainSelect, makeDbMock, makeSelectMock, mergedRow } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const ENTRIES = [
  { id: ENTRY_ID, date: '2026-03-02', slot: 'dinner', status: 'planned' },
  { id: '22222222-2222-4222-8222-222222222222', date: '2026-03-05', slot: 'lunch', status: 'cooked' },
];

const PLANNED_ENTRY = {
  id: ENTRY_ID,
  date: '2026-07-20',
  slot: 'dinner',
  recipeId: RECIPE_ID,
  freeformNote: null,
  servings: '1',
  status: 'planned',
  substituteRecipeId: null,
  notes: null,
};

const COOKED_ENTRY = { ...PLANNED_ENTRY, status: 'cooked' };
const FREEFORM_ENTRY = {
  ...PLANNED_ENTRY,
  recipeId: null,
  freeformNote: 'takeaway',
};

type WriteMockOpts = {
  existing?: unknown | null;
  insertRow?: unknown;
  updateRow?: unknown;
  feedbackRows?: unknown[];
  throwOnInsert?: unknown;
  throwOnUpdate?: unknown;
};

function makeWriteMock(opts: WriteMockOpts = {}) {
  const existing = opts.existing === undefined ? PLANNED_ENTRY : opts.existing;

  return makeDbMock({
    insertRows: (recorded, record) => {
      if (opts.throwOnInsert) throw opts.throwOnInsert;
      return opts.insertRow ? [opts.insertRow] : mergedRow(PLANNED_ENTRY)(recorded, record);
    },
    updateRows: (recorded, record) => {
      if (opts.throwOnUpdate) throw opts.throwOnUpdate;
      return opts.updateRow ? [opts.updateRow] : mergedRow(PLANNED_ENTRY)(recorded, record);
    },
    // PATCH locks the row inside the transaction: select().from().where().for('update')
    txSelect: () => chainSelect(existing == null ? [] : [existing]),
    // DELETE pre-checks cook feedback (select().from().where().limit()).
    select: makeSelectRouter([[cookFeedback, opts.feedbackRows ?? []]]).select,
    query: {
      mealPlanEntries: { findFirst: vi.fn(async () => existing) },
    },
  });
}

function jsonReq(method: string, path: string, body?: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

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

  test('PATCH rejects an empty body', async () => {
    const { db } = makeWriteMock();
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', {}),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.formErrors).toEqual(['Empty patch body']);
  });

  test('PATCH rejects unknown keys', async () => {
    const { db } = makeWriteMock();
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { notes: 'ok', extra: true }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
  });

  test('PATCH rejects clearing the last content field', async () => {
    const { db, updates } = makeWriteMock({ existing: FREEFORM_ENTRY });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { freeformNote: null }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.formErrors).toEqual([
      'Either recipeId or freeformNote is required',
    ]);
    expect(updates).toHaveLength(0);
  });

  test('PATCH returns 404 when entry missing', async () => {
    const { db } = makeWriteMock({ existing: null });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { notes: 'x' }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('PATCH cannot mark an entry cooked', async () => {
    const { db } = makeWriteMock({ existing: PLANNED_ENTRY });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { status: 'cooked' }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Use POST /meal-plans/:id/cook to mark an entry cooked',
    });
  });

  test('PATCH cannot change the status of a cooked entry', async () => {
    const { db } = makeWriteMock({ existing: COOKED_ENTRY });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { status: 'planned' }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Cooked meal plan entry status is immutable',
    });
  });

  test('PATCH accepts a no-op cooked status and other fields on a cooked entry', async () => {
    const { db, updates } = makeWriteMock({
      existing: COOKED_ENTRY,
      updateRow: { ...COOKED_ENTRY, notes: 'salty' },
    });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { status: 'cooked', notes: 'salty' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).notes).toBe('salty');
    expect(updates[0]).toMatchObject({ status: 'cooked', notes: 'salty' });
  });

  test('PATCH cannot change the cook inputs of a cooked entry', async () => {
    const OTHER_RECIPE_ID = 'ffffffff-1111-4222-8333-444444444444';
    const cases: Array<[string, Record<string, unknown>]> = [
      ['recipeId', { recipeId: OTHER_RECIPE_ID }],
      ['recipeId cleared', { recipeId: null }],
      ['substituteRecipeId', { substituteRecipeId: OTHER_RECIPE_ID }],
      ['servings', { servings: 4 }],
      ['cook input alongside an editable field', { servings: 4, notes: 'salty' }],
    ];

    for (const [label, patch] of cases) {
      const { db, updates } = makeWriteMock({ existing: COOKED_ENTRY });
      const res = await mealPlansRoutes(db).request(
        `/${ENTRY_ID}`,
        jsonReq('PATCH', '/', patch),
      );
      expect(res.status, `expected 409 for ${label}`).toBe(409);
      expect(await res.json()).toEqual({
        error: 'Cooked meal plan entry recipe and servings are immutable',
      });
      // The guard must reject before writing anything.
      expect(updates, `expected no update for ${label}`).toHaveLength(0);
    }
  });

  test('PATCH accepts a no-op resend of the cook inputs on a cooked entry', async () => {
    // servings is a numeric column, so it reads back as '2.00' — an unchanged
    // resend of 2 must compare equal rather than trip the guard.
    const entry = { ...COOKED_ENTRY, servings: '2.00' };
    const { db, updates } = makeWriteMock({
      existing: entry,
      updateRow: { ...entry, notes: 'salty' },
    });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', {
        recipeId: RECIPE_ID,
        substituteRecipeId: null,
        servings: 2,
        notes: 'salty',
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).notes).toBe('salty');
    expect(updates[0]).toMatchObject({ notes: 'salty' });
  });

  test('PATCH allows date and slot edits on a cooked entry', async () => {
    const { db, updates } = makeWriteMock({
      existing: COOKED_ENTRY,
      updateRow: { ...COOKED_ENTRY, date: '2026-07-22', slot: 'lunch' },
    });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { date: '2026-07-22', slot: 'lunch' }),
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ date: '2026-07-22', slot: 'lunch' });
  });

  test('PATCH still allows cook-input edits on a non-cooked entry', async () => {
    const { db, updates } = makeWriteMock({
      existing: PLANNED_ENTRY,
      updateRow: { ...PLANNED_ENTRY, servings: '4' },
    });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { servings: 4 }),
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ servings: '4' });
  });

  test('PATCH allows planned -> skipped', async () => {
    const { db, updates } = makeWriteMock({
      updateRow: { ...PLANNED_ENTRY, status: 'skipped' },
    });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { status: 'skipped' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('skipped');
    expect(updates[0]).toMatchObject({ status: 'skipped' });
  });

  test('DELETE returns 409 when cook feedback exists', async () => {
    const { db, deletes } = makeWriteMock({
      existing: COOKED_ENTRY,
      feedbackRows: [{ id: 'fb' }],
    });
    const res = await mealPlansRoutes(db).request(`/${ENTRY_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Meal plan entry has cook feedback' });
    expect(deletes).toHaveLength(0);
  });

  test('DELETE returns 204 and 404 for a missing entry', async () => {
    const ok = makeWriteMock({ existing: PLANNED_ENTRY, feedbackRows: [] });
    const resOk = await mealPlansRoutes(ok.db).request(`/${ENTRY_ID}`, { method: 'DELETE' });
    expect(resOk.status).toBe(204);
    expect(ok.deletes).toHaveLength(1);

    const miss = makeWriteMock({ existing: null });
    const resMiss = await mealPlansRoutes(miss.db).request(`/${ENTRY_ID}`, {
      method: 'DELETE',
    });
    expect(resMiss.status).toBe(404);
    expect(await resMiss.json()).toEqual({ error: 'Not found' });
  });

  test('write routes reject a malformed :id before touching the db', async () => {
    let touched = false;
    const db = {
      query: {
        mealPlanEntries: {
          findFirst: async () => {
            touched = true;
            return null;
          },
        },
      },
    } as any;
    const app = mealPlansRoutes(db);
    const patch = await app.request(
      '/not-a-uuid',
      jsonReq('PATCH', '/', { notes: 'x' }),
    );
    expect(patch.status).toBe(400);
    expect(await patch.json()).toEqual({ error: 'Invalid id format' });
    const del = await app.request('/not-a-uuid', { method: 'DELETE' });
    expect(del.status).toBe(400);
    expect(await del.json()).toEqual({ error: 'Invalid id format' });
    expect(touched).toBe(false);
  });
});
