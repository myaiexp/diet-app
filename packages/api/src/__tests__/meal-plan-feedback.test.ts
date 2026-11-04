// POST/GET /meal-plans/:id/feedback: create, read, constraint races

import { describe, test, expect } from 'vitest';
import { mealPlanFeedbackRoutes } from '../routes/meal-plan-feedback.js';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { pgError } from './db-mock.js';
import {
  ENTRY_ID,
  FB_ID,
  PLANNED_ENTRY,
  FEEDBACK,
  VALID_CREATE,
  json,
  makeWriteMock,
} from './meal-plan-feedback-test-helpers.js';

describe('mealPlanFeedbackRoutes', () => {
  test('POST creates feedback for a cooked entry', async () => {
    const { db, inserts } = makeWriteMock({
      feedback: null,
      insertRow: { ...FEEDBACK },
    });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', VALID_CREATE),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.rating).toBe('thumbs_up');
    expect(inserts[0]).toMatchObject({
      mealPlanEntryId: ENTRY_ID,
      usedAsIs: true,
      changesNote: null,
    });
  });

  test('POST returns 409 when the entry is not cooked', async () => {
    const { db } = makeWriteMock({ entry: PLANNED_ENTRY, feedback: null });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', VALID_CREATE),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Meal plan entry is not cooked' });
  });

  test('POST returns 409 when feedback already exists', async () => {
    const { db } = makeWriteMock({ feedback: FEEDBACK });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', VALID_CREATE),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Feedback already exists for this meal plan entry',
    });
  });

  test('POST maps a unique-violation race (23505) to the same 409', async () => {
    const { db } = makeWriteMock({
      feedback: null,
      throwOnWrite: pgError('23505'),
    });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', VALID_CREATE),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Feedback already exists for this meal plan entry',
    });
  });

  test('POST maps an FK violation race (23503) to 404', async () => {
    // The entry was deleted between the cooked-status check and the insert, so
    // the feedback has nothing to attach to — 404, not the unique-violation 409.
    const { db } = makeWriteMock({
      feedback: null,
      throwOnWrite: pgError('23503'),
    });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', VALID_CREATE),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('POST lets a non-constraint database error escape as a 500', async () => {
    const { db } = makeWriteMock({ feedback: null, throwOnWrite: pgError('23502') });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', VALID_CREATE),
    );
    expect(res.status).toBe(500);
  });

  test('POST requires changesNote when usedAsIs is false', async () => {
    const { db, inserts } = makeWriteMock({ feedback: null });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', { ...VALID_CREATE, usedAsIs: false }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
    expect(inserts).toHaveLength(0);
  });

  test('POST rejects changesNote when usedAsIs is true', async () => {
    const { db, inserts } = makeWriteMock({ feedback: null });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', { ...VALID_CREATE, changesNote: 'nope' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
    expect(inserts).toHaveLength(0);
  });

  test('POST rejects values outside the enum vocabularies', async () => {
    const { db } = makeWriteMock({ feedback: null });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('POST', {
        rating: 'meh',
        effortCheck: 'fine',
        makeAgain: 'sure',
        usedAsIs: true,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
  });

  test('GET returns the feedback, 404 when absent', async () => {
    const found = makeWriteMock({ feedback: FEEDBACK });
    const resOk = await mealPlanFeedbackRoutes(found.db).request(
      `/${ENTRY_ID}/feedback`,
    );
    expect(resOk.status).toBe(200);
    expect((await resOk.json()).id).toBe(FB_ID);

    const miss = makeWriteMock({ feedback: null });
    const resMiss = await mealPlanFeedbackRoutes(miss.db).request(
      `/${ENTRY_ID}/feedback`,
    );
    expect(resMiss.status).toBe(404);
    expect(await resMiss.json()).toEqual({ error: 'Not found' });
  });

  test('is mounted on mealPlansRoutes', async () => {
    const { db } = makeWriteMock({ feedback: FEEDBACK });
    // mealPlansRoutes needs select for week etc.; only hit feedback path
    const res = await mealPlansRoutes(db).request(`/${ENTRY_ID}/feedback`);
    expect(res.status).toBe(200);
  });
});
