// The one encoding of the cook-feedback note invariant, and its two callers

import { describe, test, expect, vi } from 'vitest';
import {
  feedbackPairError,
  feedbackCreateSchema,
  NOTE_ABSENT_MSG,
  NOTE_REQUIRED_MSG,
} from '../schemas/meal-plans.js';
import { mealPlanFeedbackRoutes } from '../routes/meal-plan-feedback.js';
import { makeDbMock } from './db-mock.js';

describe('feedbackPairError', () => {
  test('a changed meal needs a note', () => {
    expect(feedbackPairError(false, null)).toBe(NOTE_REQUIRED_MSG);
    expect(feedbackPairError(false, undefined)).toBe(NOTE_REQUIRED_MSG);
    // A stored empty string is reachable from the DB side — the column has no
    // CHECK — so the helper has to read '' as "no note", not as a note.
    expect(feedbackPairError(false, '')).toBe(NOTE_REQUIRED_MSG);
    expect(feedbackPairError(false, 'less salt')).toBeNull();
  });

  test('an unchanged meal must carry no note', () => {
    expect(feedbackPairError(true, null)).toBeNull();
    expect(feedbackPairError(true, undefined)).toBeNull();
    expect(feedbackPairError(true, 'extra garlic')).toBe(NOTE_ABSENT_MSG);
    expect(feedbackPairError(true, '')).toBe(NOTE_ABSENT_MSG);
  });
});

describe('both entry points report the same violation', () => {
  // The wording used to be typed out four times — twice in the create schema
  // and twice in the PATCH handler. These pin that POST and PATCH still answer
  // a given violation identically, which is what routing both through one
  // helper buys.
  const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
  const STORED = {
    id: '22222222-2222-4222-8222-222222222222',
    mealPlanEntryId: ENTRY_ID,
    rating: 'thumbs_up',
    effortCheck: 'felt_right',
    makeAgain: 'yes',
    usedAsIs: true,
    changesNote: null,
  };

  function patch(body: unknown, stored: unknown = STORED) {
    const { db } = makeDbMock({
      query: { cookFeedback: { findFirst: vi.fn(async () => stored) } },
    });
    return mealPlanFeedbackRoutes(db).request(`/${ENTRY_ID}/feedback`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function createIssues(body: Record<string, unknown>): string[] {
    const parsed = feedbackCreateSchema.safeParse(body);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  }

  const BASE = { rating: 'thumbs_up', effortCheck: 'felt_right', makeAgain: 'yes' };

  test('POST schema and PATCH merge share the "note required" wording', async () => {
    expect(createIssues({ ...BASE, usedAsIs: false })).toContain(NOTE_REQUIRED_MSG);

    const res = await patch({ usedAsIs: false });
    expect(res.status).toBe(400);
    expect((await res.json()).details.formErrors).toEqual([NOTE_REQUIRED_MSG]);
  });

  test('POST schema and PATCH merge share the "note absent" wording', async () => {
    expect(
      createIssues({ ...BASE, usedAsIs: true, changesNote: 'nope' }),
    ).toContain(NOTE_ABSENT_MSG);

    const res = await patch({ usedAsIs: true, changesNote: 'more salt' }, {
      ...STORED,
      usedAsIs: false,
      changesNote: 'extra garlic',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).details.formErrors).toEqual([NOTE_ABSENT_MSG]);
  });
});
