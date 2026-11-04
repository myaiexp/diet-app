// Shared fixtures and write-mock builder for the meal-plan feedback test files.

import { vi } from 'vitest';
import { makeDbMock, mergedRow } from './db-mock.js';

export const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
export const FB_ID = '22222222-2222-4222-8222-222222222222';

export const COOKED_ENTRY = {
  id: ENTRY_ID,
  status: 'cooked',
  recipeId: null,
  freeformNote: 'x',
};

export const PLANNED_ENTRY = { ...COOKED_ENTRY, status: 'planned' };

export const FEEDBACK = {
  id: FB_ID,
  mealPlanEntryId: ENTRY_ID,
  rating: 'thumbs_up',
  effortCheck: 'felt_right',
  makeAgain: 'yes',
  usedAsIs: true,
  changesNote: null,
};

export const VALID_CREATE = {
  rating: 'thumbs_up',
  effortCheck: 'felt_right',
  makeAgain: 'yes',
  usedAsIs: true,
};

export type MockOpts = {
  entry?: unknown | null;
  feedback?: unknown | null;
  insertRow?: unknown;
  updateRow?: unknown;
  /** Full RETURNING array for UPDATE — use [] for the delete-between-read race. */
  updateRows?: unknown[];
  /** Driver-shaped error thrown at the handler's write (FK / unique races). */
  throwOnWrite?: unknown;
};

export function makeWriteMock(opts: MockOpts = {}) {
  return makeDbMock({
    insertRows: (recorded, record) =>
      opts.insertRow ? [opts.insertRow] : mergedRow(FEEDBACK)(recorded, record),
    updateRows:
      opts.updateRows !== undefined
        ? () => opts.updateRows!
        : opts.updateRow
          ? () => [opts.updateRow]
          : mergedRow(FEEDBACK),
    throwOnWrite: () => opts.throwOnWrite,
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

export function json(method: string, body?: unknown) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
