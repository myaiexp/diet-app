// Shared fixtures and db mocks for the pantry route suites.

import { vi } from 'vitest';
import { makeDbMock, mergedRow } from './db-mock.js';

/**
 * The list endpoint reads relationally (it eager-loads `ingredient`), so it has
 * no chainable builder to record — the args object it passes to findMany is the
 * whole assertion surface: ordering, paging and the `with` clause alike.
 */
export function makeListMock(rows: unknown[]) {
  const calls: { args?: Record<string, unknown> } = {};
  const db = {
    query: {
      pantryItems: {
        findMany: vi.fn(async (args: Record<string, unknown>) => {
          calls.args = args;
          return rows;
        }),
      },
    },
  } as any;
  return { db, calls };
}

// Mock-based route tests for pantryRoutes — deterministic, Postgres-free.
// The GET handlers use the real `new Date()`, so far-future / far-past expiry
// dates keep computeStatus deterministic on any run date and in any timezone.
export const FRESH_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  ingredientId: '22222222-2222-4222-8222-222222222222',
  quantity: '2',
  unit: 'pcs',
  location: 'fridge',
  addedDate: '2026-07-01',
  expiresDate: '2099-12-31',
  opened: false,
};
export const EXPIRED_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  expiresDate: '2000-01-01',
};

export const INGREDIENT_ID = '22222222-2222-4222-8222-222222222222';
export const ITEM_ID = '11111111-1111-4111-8111-111111111111';
export const INGREDIENT = {
  id: INGREDIENT_ID,
  name: 'Salmon fillet',
  aliases: ['lohifile'],
  shelfLife: { fridge_days: 7 },
};

export function makeWriteMock(opts: {
  ingredient?: Record<string, unknown> | null;
  /** Existing pantry row for PATCH; use null for 404. Default: FRESH_ROW. */
  existingItem?: unknown | null;
  insertRow?: unknown;
  updateRow?: unknown;
  /** Full RETURNING array for UPDATE — use [] for the delete-between-read race. */
  updateRows?: unknown[];
  deleteRows?: unknown[];
  /** Driver-shaped error thrown at the handler's write (FK races). */
  throwOnWrite?: unknown;
}) {
  return makeDbMock({
    throwOnWrite: () => opts.throwOnWrite,
    insertRows: () => [opts.insertRow ?? FRESH_ROW],
    updateRows:
      opts.updateRows !== undefined
        ? () => opts.updateRows!
        : opts.updateRow
          ? () => [opts.updateRow]
          : mergedRow(FRESH_ROW),
    deleteRows: () => opts.deleteRows ?? [{ id: ITEM_ID }],
    query: {
      ingredients: {
        findFirst: vi.fn(async () =>
          opts.ingredient === undefined ? INGREDIENT : opts.ingredient,
        ),
      },
      pantryItems: {
        findFirst: vi.fn(async () =>
          opts.existingItem === undefined
            ? { ...FRESH_ROW, ingredient: INGREDIENT }
            : opts.existingItem,
        ),
      },
    },
  });
}
