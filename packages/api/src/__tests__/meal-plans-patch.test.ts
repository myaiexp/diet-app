// mealPlansRoutes PATCH: edits, cooked-entry locks and status rules

import { describe, test, expect } from 'vitest';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { pgError } from './db-mock.js';
import {
  COOKED_ENTRY,
  PLANNED_ENTRY,
  FREEFORM_ENTRY,
  RECIPE_ID,
  ENTRY_ID,
  jsonReq,
  makeWriteMock,
} from './meal-plans-test-helpers.js';

describe('mealPlansRoutes', () => {
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
      'One of recipeId, substituteRecipeId, or a non-empty freeformNote is required',
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

  test('PATCH maps an FK violation (23503) to 400 Invalid reference', async () => {
    // The update runs inside the FOR UPDATE transaction, so this also proves
    // the mapping survives being thrown across the transaction boundary.
    const { db, updates } = makeWriteMock({ throwOnWrite: pgError('23503') });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq('PATCH', '/', { recipeId: RECIPE_ID }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid reference' });
    expect(updates).toHaveLength(1);
  });
});
