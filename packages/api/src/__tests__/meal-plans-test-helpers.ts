// Shared fixtures and write-mock builder for the mealPlansRoutes test files.

import { vi } from 'vitest';
import { cookFeedback } from '@diet-app/db';
import { chainSelect, makeDbMock, mergedRow } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';

export const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
export const RECIPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

export const ENTRIES = [
  { id: ENTRY_ID, date: '2026-03-02', slot: 'dinner', status: 'planned' },
  { id: '22222222-2222-4222-8222-222222222222', date: '2026-03-05', slot: 'lunch', status: 'cooked' },
];

export const PLANNED_ENTRY = {
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

export const COOKED_ENTRY = { ...PLANNED_ENTRY, status: 'cooked' };
export const FREEFORM_ENTRY = {
  ...PLANNED_ENTRY,
  recipeId: null,
  freeformNote: 'takeaway',
};

export type WriteMockOpts = {
  existing?: unknown | null;
  insertRow?: unknown;
  updateRow?: unknown;
  feedbackRows?: unknown[];
  /** Driver-shaped error thrown at the handler's write (FK / unique races). */
  throwOnWrite?: unknown;
};

export function makeWriteMock(opts: WriteMockOpts = {}) {
  const existing = opts.existing === undefined ? PLANNED_ENTRY : opts.existing;

  return makeDbMock({
    insertRows: (recorded, record) =>
      opts.insertRow ? [opts.insertRow] : mergedRow(PLANNED_ENTRY)(recorded, record),
    updateRows: (recorded, record) =>
      opts.updateRow ? [opts.updateRow] : mergedRow(PLANNED_ENTRY)(recorded, record),
    throwOnWrite: () => opts.throwOnWrite,
    // PATCH locks the row inside the transaction: select().from().where().for('update')
    txSelect: () => chainSelect(existing == null ? [] : [existing]),
    // DELETE pre-checks cook feedback (select().from().where().limit()).
    select: makeSelectRouter([[cookFeedback, opts.feedbackRows ?? []]]).select,
    query: {
      mealPlanEntries: { findFirst: vi.fn(async () => existing) },
    },
  });
}

export function jsonReq(method: string, path: string, body?: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
