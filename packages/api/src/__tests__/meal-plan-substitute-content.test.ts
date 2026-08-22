// PATCH content for a substitute-only entry (demo Friday dinner: recipeId
// null, substituteRecipeId set). Cook and shopping already resolve that pair;
// hasContent used to ignore the substitute column, so any edit of that row
// 400'd unless the client clobbered recipeId.

import { describe, test, expect, vi } from 'vitest';
import { mealPlansRoutes } from '../routes/meal-plans.js';
import { cookFeedback } from '@diet-app/db';
import { chainSelect, makeDbMock, mergedRow } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_RECIPE_ID = 'ffffffff-1111-4222-8333-444444444444';

const SUBSTITUTE_ONLY = {
  id: ENTRY_ID,
  date: '2026-07-20',
  slot: 'dinner',
  recipeId: null,
  freeformNote: null,
  servings: '1',
  status: 'substituted',
  substituteRecipeId: RECIPE_ID,
  notes: null,
};

function makeWriteMock(opts: { existing?: unknown; updateRow?: unknown } = {}) {
  const existing = opts.existing === undefined ? SUBSTITUTE_ONLY : opts.existing;
  return makeDbMock({
    updateRows: (recorded, record) =>
      opts.updateRow ? [opts.updateRow] : mergedRow(SUBSTITUTE_ONLY)(recorded, record),
    txSelect: () => chainSelect(existing == null ? [] : [existing]),
    select: makeSelectRouter([[cookFeedback, []]]).select,
    query: { mealPlanEntries: { findFirst: vi.fn(async () => existing) } },
  });
}

function jsonReq(body: unknown) {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('PATCH substitute-only content', () => {
  test('a notes-only patch on a substitute-only entry is content, not a 400', async () => {
    const { db, updates } = makeWriteMock({
      updateRow: { ...SUBSTITUTE_ONLY, notes: 'used the last fillet' },
    });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq({ notes: 'used the last fillet' }),
    );
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
  });

  test('writing a new substituteRecipeId (and clearing the note) keeps content', async () => {
    const { db, updates } = makeWriteMock({
      updateRow: { ...SUBSTITUTE_ONLY, substituteRecipeId: OTHER_RECIPE_ID },
    });
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq({ substituteRecipeId: OTHER_RECIPE_ID, freeformNote: null }),
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ substituteRecipeId: OTHER_RECIPE_ID });
  });

  test('clearing recipeId, substituteRecipeId, and the note together is still empty', async () => {
    const { db, updates } = makeWriteMock();
    const res = await mealPlansRoutes(db).request(
      `/${ENTRY_ID}`,
      jsonReq({ recipeId: null, substituteRecipeId: null, freeformNote: null }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).details.formErrors).toEqual([
      'Either recipeId or freeformNote is required',
    ]);
    expect(updates).toHaveLength(0);
  });
});
