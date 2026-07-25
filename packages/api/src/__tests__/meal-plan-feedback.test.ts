// Mock-based tests for GET/POST/PATCH /meal-plans/:id/feedback

import { describe, test, expect, vi } from 'vitest';
import { mealPlanFeedbackRoutes } from '../routes/meal-plan-feedback.js';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { makeDbMock, mergedRow } from './db-mock.js';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const FB_ID = '22222222-2222-4222-8222-222222222222';

const COOKED_ENTRY = {
  id: ENTRY_ID,
  status: 'cooked',
  recipeId: null,
  freeformNote: 'x',
};

const PLANNED_ENTRY = { ...COOKED_ENTRY, status: 'planned' };

const FEEDBACK = {
  id: FB_ID,
  mealPlanEntryId: ENTRY_ID,
  rating: 'thumbs_up',
  effortCheck: 'felt_right',
  makeAgain: 'yes',
  usedAsIs: true,
  changesNote: null,
};

const VALID_CREATE = {
  rating: 'thumbs_up',
  effortCheck: 'felt_right',
  makeAgain: 'yes',
  usedAsIs: true,
};

type MockOpts = {
  entry?: unknown | null;
  feedback?: unknown | null;
  insertRow?: unknown;
  updateRow?: unknown;
  throwOnInsert?: unknown;
};

function makeWriteMock(opts: MockOpts = {}) {
  return makeDbMock({
    insertRows: (recorded, record) => {
      if (opts.throwOnInsert) throw opts.throwOnInsert;
      return opts.insertRow ? [opts.insertRow] : mergedRow(FEEDBACK)(recorded, record);
    },
    updateRows: opts.updateRow ? () => [opts.updateRow] : mergedRow(FEEDBACK),
    query: {
      mealPlanEntries: {
        findFirst: vi.fn(async () =>
          opts.entry === undefined ? COOKED_ENTRY : opts.entry,
        ),
      },
      cookFeedback: {
        findFirst: vi.fn(async () =>
          opts.feedback === undefined ? null : opts.feedback,
        ),
      },
    },
  });
}

function json(method: string, body?: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

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
      throwOnInsert: { code: '23505' },
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

  test('PATCH enforces the usedAsIs rule against the merged row', async () => {
    const stored = { ...FEEDBACK, usedAsIs: true, changesNote: null };

    const bad = makeWriteMock({ feedback: stored });
    const resBad = await mealPlanFeedbackRoutes(bad.db).request(
      `/${ENTRY_ID}/feedback`,
      json('PATCH', { usedAsIs: false }),
    );
    expect(resBad.status).toBe(400);
    expect((await resBad.json()).error).toBe('Validation failed');
    expect(bad.updates).toHaveLength(0);

    const ok = makeWriteMock({
      feedback: stored,
      updateRow: { ...stored, usedAsIs: false, changesNote: 'less salt' },
    });
    const resOk = await mealPlanFeedbackRoutes(ok.db).request(
      `/${ENTRY_ID}/feedback`,
      json('PATCH', { usedAsIs: false, changesNote: 'less salt' }),
    );
    expect(resOk.status).toBe(200);
    expect(ok.updates[0]).toMatchObject({
      usedAsIs: false,
      changesNote: 'less salt',
    });
  });

  test('PATCH usedAsIs true auto-clears a stored changesNote', async () => {
    const stored = {
      ...FEEDBACK,
      usedAsIs: false,
      changesNote: 'extra garlic',
    };
    const { db, updates } = makeWriteMock({
      feedback: stored,
      updateRow: { ...stored, usedAsIs: true, changesNote: null },
    });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('PATCH', { usedAsIs: true }),
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ usedAsIs: true, changesNote: null });
  });

  test('PATCH rejects an empty body and unknown keys', async () => {
    const empty = makeWriteMock({ feedback: FEEDBACK });
    const resEmpty = await mealPlanFeedbackRoutes(empty.db).request(
      `/${ENTRY_ID}/feedback`,
      json('PATCH', {}),
    );
    expect(resEmpty.status).toBe(400);
    expect((await resEmpty.json()).details.formErrors).toEqual([
      'Empty patch body',
    ]);

    const unknown = makeWriteMock({ feedback: FEEDBACK });
    const resUnknown = await mealPlanFeedbackRoutes(unknown.db).request(
      `/${ENTRY_ID}/feedback`,
      json('PATCH', { rating: 'thumbs_up', extra: 1 }),
    );
    expect(resUnknown.status).toBe(400);
    expect((await resUnknown.json()).error).toBe('Validation failed');
  });

  test('all three routes reject a malformed :id before touching the db', async () => {
    let touched = false;
    const db = {
      query: {
        mealPlanEntries: {
          findFirst: async () => {
            touched = true;
            return null;
          },
        },
        cookFeedback: {
          findFirst: async () => {
            touched = true;
            return null;
          },
        },
      },
    } as any;
    const app = mealPlanFeedbackRoutes(db);
    for (const [method, path] of [
      ['GET', '/not-a-uuid/feedback'],
      ['POST', '/not-a-uuid/feedback'],
      ['PATCH', '/not-a-uuid/feedback'],
    ] as const) {
      const res = await app.request(
        path,
        method === 'GET'
          ? { method }
          : json(method, method === 'POST' ? VALID_CREATE : { rating: 'thumbs_up' }),
      );
      expect(res.status, method).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid id format' });
    }
    expect(touched).toBe(false);
  });

  test('is mounted on mealPlansRoutes', async () => {
    const { db } = makeWriteMock({ feedback: FEEDBACK });
    // mealPlansRoutes needs select for week etc.; only hit feedback path
    const res = await mealPlansRoutes(db).request(`/${ENTRY_ID}/feedback`);
    expect(res.status).toBe(200);
  });
});
