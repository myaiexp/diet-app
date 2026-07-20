// Mock-based route tests for mealPlansRoutes — week GET + write paths

import { describe, test, expect, vi } from 'vitest';
import { mealPlansRoutes } from '../routes/meal-plans.js';

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

// The week handler calls db.select().from(mealPlanEntries).where(...).
function mockDbReturning(rows: unknown[]) {
  return { select: () => ({ from: () => ({ where: async () => rows }) }) } as any;
}

type WriteMockOpts = {
  existing?: unknown | null;
  insertRow?: unknown;
  updateRow?: unknown;
  feedbackRows?: unknown[];
  throwOnInsert?: unknown;
  throwOnUpdate?: unknown;
};

function makeWriteMock(opts: WriteMockOpts = {}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const deletes: unknown[] = [];
  let selectCall = 0;

  const insertBuilder: any = {
    values: (v: unknown) => {
      inserts.push(v);
      return insertBuilder;
    },
    returning: async () => {
      if (opts.throwOnInsert) throw opts.throwOnInsert;
      return [opts.insertRow ?? { ...PLANNED_ENTRY, ...(inserts[0] as object) }];
    },
  };
  const updateBuilder: any = {
    set: (v: unknown) => {
      updates.push(v);
      return updateBuilder;
    },
    where: () => updateBuilder,
    returning: async () => {
      if (opts.throwOnUpdate) throw opts.throwOnUpdate;
      return [opts.updateRow ?? { ...PLANNED_ENTRY, ...(updates[0] as object) }];
    },
  };
  const deleteBuilder: any = {
    where: () => {
      deletes.push('delete');
      return deleteBuilder;
    },
  };

  const db = {
    query: {
      mealPlanEntries: {
        findFirst: vi.fn(async () =>
          opts.existing === undefined ? PLANNED_ENTRY : opts.existing,
        ),
      },
    },
    insert: () => insertBuilder,
    update: () => updateBuilder,
    delete: () => deleteBuilder,
    select: () => {
      // DELETE feedback pre-check uses select().from().where().limit()
      const idx = selectCall++;
      const rows = idx === 0 ? (opts.feedbackRows ?? []) : [];
      const builder: any = {
        from: () => builder,
        where: () => builder,
        limit: () => builder,
        then: (resolve: (v: unknown) => unknown) => resolve(rows),
      };
      return builder;
    },
  } as any;

  return { db, inserts, updates, deletes };
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
    const app = mealPlansRoutes(mockDbReturning(ENTRIES));
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
    const app = mealPlansRoutes(mockDbReturning([]));
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
