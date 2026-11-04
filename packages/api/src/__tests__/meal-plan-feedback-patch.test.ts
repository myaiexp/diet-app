// PATCH /meal-plans/:id/feedback, and malformed ids on all three routes

import { describe, test, expect } from 'vitest';
import { mealPlanFeedbackRoutes } from '../routes/meal-plan-feedback.js';
import {
  ENTRY_ID,
  FEEDBACK,
  VALID_CREATE,
  json,
  makeWriteMock,
} from './meal-plan-feedback-test-helpers.js';

describe('mealPlanFeedbackRoutes', () => {
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

  test('PATCH rejects usedAsIs true sent together with a note', async () => {
    // The auto-clear only applies to a note the patch didn't mention — an
    // explicit note alongside usedAsIs:true is a contradiction, not something
    // to quietly repair into a null.
    const { db, updates } = makeWriteMock({
      feedback: { ...FEEDBACK, usedAsIs: false, changesNote: 'extra garlic' },
    });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('PATCH', { usedAsIs: true, changesNote: 'more salt' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).details.formErrors).toEqual([
      'changesNote must be absent when usedAsIs is true',
    ]);
    expect(updates).toHaveLength(0);
  });

  test('PATCH writes the pair it validated, even when the body names neither field', async () => {
    // The invariant the handler enforces is on the *merged* pair, so the write
    // has to carry that same pair — validating one thing and persisting another
    // is how the 1:1 rule would drift out of sync.
    const stored = { ...FEEDBACK, usedAsIs: false, changesNote: 'extra garlic' };
    const { db, updates } = makeWriteMock({ feedback: stored });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('PATCH', { rating: 'thumbs_down' }),
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      rating: 'thumbs_down',
      usedAsIs: false,
      changesNote: 'extra garlic',
    });
  });

  test('PATCH returns 404 when the row is gone between read and update', async () => {
    const { db } = makeWriteMock({ feedback: FEEDBACK, updateRows: [] });
    const res = await mealPlanFeedbackRoutes(db).request(
      `/${ENTRY_ID}/feedback`,
      json('PATCH', { rating: 'thumbs_down' }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
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
});
