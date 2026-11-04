// mealPlansRoutes DELETE guards and malformed-id rejection on write routes

import { describe, test, expect } from 'vitest';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { pgError } from './db-mock.js';
import {
  COOKED_ENTRY,
  PLANNED_ENTRY,
  ENTRY_ID,
  jsonReq,
  makeWriteMock,
} from './meal-plans-test-helpers.js';

describe('mealPlansRoutes', () => {
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

  test('DELETE maps an FK violation (23503) to the same 409 as the pre-check', async () => {
    // Feedback inserted between the pre-check and the delete: the race has to
    // land on the same message the pre-check would have produced.
    const { db, deletes } = makeWriteMock({
      existing: COOKED_ENTRY,
      feedbackRows: [],
      throwOnWrite: pgError('23503'),
    });
    const res = await mealPlansRoutes(db).request(`/${ENTRY_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Meal plan entry has cook feedback' });
    expect(deletes).toHaveLength(1);
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
