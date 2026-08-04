// Mock-based route tests for shoppingListsRoutes — deterministic, Postgres-free.
// Covers the list reads (paging order, item sorting), the status PATCH guards
// that keep `done` owned by POST /:id/complete, and the delete guard.

import { describe, test, expect } from 'vitest';
import { asc, desc, lte } from 'drizzle-orm';
import { shoppingLists } from '@diet-app/db';
import { shoppingListsRoutes } from '../routes/shopping-lists.js';
import { makeDbMock, makeSelectMock, mergedRow } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../pagination.js';

const LIST_ID = '11111111-1111-1111-1111-111111111111';

const ITEM = (over: Record<string, unknown>) => ({
  id: '22222222-2222-2222-2222-222222222222',
  netToBuy: '2',
  category: 'produce',
  ingredient: { id: '33333333-3333-3333-3333-333333333333', name: 'Onion', isPantryStaple: false },
  ...over,
});

const LIST = {
  id: LIST_ID,
  weekStarting: '2026-06-15',
  status: 'draft',
  items: [ITEM({})],
};

// A staple and a non-staple whose alphabetical order is the reverse of the
// order sortListItems must produce — so a suite that forgot to sort fails.
const MIXED_ITEMS = [
  ITEM({
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    category: 'condiment',
    ingredient: { name: 'Olive oil', isPantryStaple: true },
  }),
  ITEM({
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    category: 'produce',
    ingredient: { name: 'Leek', isPantryStaple: false },
  }),
];

const relationalDb = (findFirst: (config?: any) => unknown) =>
  ({ query: { shoppingLists: { findFirst: async (config?: any) => findFirst(config) } } }) as any;

const patchRequest = (db: any, body: unknown, id = LIST_ID) =>
  shoppingListsRoutes(db).request(`/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// A list row the PATCH/DELETE transaction locks with .for('update').
const lockedList = (status: string) =>
  makeSelectRouter([[shoppingLists, [{ ...LIST, status, items: undefined }]]]);

describe('GET /api/shopping-lists — list', () => {
  test('paginates and orders lists newest week first with an id tie-break', async () => {
    const { db, calls } = makeSelectMock([LIST]);
    const res = await shoppingListsRoutes(db).request('/');
    expect(res.status).toBe(200);
    expect(calls.orderBy).toEqual([desc(shoppingLists.weekStarting), asc(shoppingLists.id)]);
    expect(calls.limit).toBe(DEFAULT_LIMIT);
    expect(calls.offset).toBe(0);
  });

  test('honours ?limit and ?offset, clamping an over-large limit', async () => {
    const { db, calls } = makeSelectMock([]);
    await shoppingListsRoutes(db).request('/?limit=9999&offset=7');
    expect(calls.limit).toBe(MAX_LIMIT);
    expect(calls.offset).toBe(7);
  });
});

describe('GET /api/shopping-lists/:id', () => {
  test('returns a list with items sorted non-staples first', async () => {
    const db = relationalDb(() => ({ ...LIST, items: MIXED_ITEMS }));
    const res = await shoppingListsRoutes(db).request(`/${LIST_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: any) => i.ingredient.name)).toEqual(['Leek', 'Olive oil']);
  });

  test('returns 404 for an unknown list id', async () => {
    const db = relationalDb(() => undefined);
    const res = await shoppingListsRoutes(db).request(`/${LIST_ID}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('returns 400 for a malformed id before touching the DB', async () => {
    const res = await shoppingListsRoutes({} as any).request('/not-a-uuid');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid id format' });
  });
});

describe('GET /api/shopping-lists/current', () => {
  test('returns 200 with the list and its items when one exists', async () => {
    const db = relationalDb(() => LIST);
    const res = await shoppingListsRoutes(db).request('/current');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(LIST_ID);
    expect(body.items[0].ingredient.name).toBe('Onion');
  });

  test('selects by week_starting, not createdAt', async () => {
    // Regression for the audit finding: the old handler ordered by createdAt with
    // no filter, so a future-week draft (higher createdAt) shadowed the real
    // current list. The fix filters week_starting <= today and orders by it desc.
    let captured: any;
    const db = relationalDb((config) => {
      captured = config;
      return LIST;
    });
    await shoppingListsRoutes(db).request('/current');

    const today = new Date().toISOString().slice(0, 10);
    expect(captured.where).toEqual(lte(shoppingLists.weekStarting, today));
    expect(captured.orderBy).toEqual(desc(shoppingLists.weekStarting));
    expect(captured.orderBy).not.toEqual(desc(shoppingLists.createdAt));
  });

  test('sorts /current items the same way', async () => {
    const db = relationalDb(() => ({ ...LIST, items: MIXED_ITEMS }));
    const res = await shoppingListsRoutes(db).request('/current');
    const body = await res.json();
    expect(body.items.map((i: any) => i.ingredient.name)).toEqual(['Leek', 'Olive oil']);
  });

  test('returns 404 with error body when none exist', async () => {
    const db = relationalDb(() => undefined);
    const res = await shoppingListsRoutes(db).request('/current');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

describe('PATCH /api/shopping-lists/:id — status', () => {
  test('updates status from draft to shopping', async () => {
    const router = lockedList('draft');
    const mock = makeDbMock({
      txSelect: router.select,
      updateRows: mergedRow({ ...LIST, items: undefined }),
    });
    const res = await patchRequest(mock.db, { status: 'shopping' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: LIST_ID, status: 'shopping' });
    expect(mock.updates[0]).toMatchObject({ status: 'shopping' });
    // The guard is only sound if the row was locked before it ran.
    expect(router.reads[0]!.forUpdate).toBe(true);
  });

  test('returns 409 when PATCH tries to set status done', async () => {
    const mock = makeDbMock({ txSelect: lockedList('draft').select });
    const res = await patchRequest(mock.db, { status: 'done' });
    expect(res.status).toBe(409);
    // The 409 exists to redirect, not just refuse — it must name the endpoint
    // that owns the transition, or the client has no way to find it.
    expect((await res.json()).error).toContain('POST /shopping-lists/:id/complete');
    expect(mock.writes).toHaveLength(0);
  });

  test('returns 409 when PATCH tries to move a done list back to shopping', async () => {
    const mock = makeDbMock({ txSelect: lockedList('done').select });
    const res = await patchRequest(mock.db, { status: 'shopping' });
    expect(res.status).toBe(409);
    expect(mock.writes).toHaveLength(0);
  });

  test('accepts a no-op status done on an already-done list', async () => {
    const mock = makeDbMock({
      txSelect: lockedList('done').select,
      updateRows: mergedRow({ ...LIST, items: undefined, status: 'done' }),
    });
    const res = await patchRequest(mock.db, { status: 'done' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'done' });
  });

  test('returns 404 for an unknown list', async () => {
    const mock = makeDbMock({ txSelect: makeSelectRouter([[shoppingLists, []]]).select });
    const res = await patchRequest(mock.db, { status: 'shopping' });
    expect(res.status).toBe(404);
  });

  test('returns 400 for an empty patch body', async () => {
    const mock = makeDbMock({ txSelect: lockedList('draft').select });
    const res = await patchRequest(mock.db, {});
    expect(res.status).toBe(400);
    expect(mock.writes).toHaveLength(0);
  });

  test('returns 400 for a status outside the enum', async () => {
    const mock = makeDbMock({ txSelect: lockedList('draft').select });
    const res = await patchRequest(mock.db, { status: 'finalized' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Validation failed' });
  });

  test('returns 400 for an unknown field', async () => {
    const mock = makeDbMock({ txSelect: lockedList('draft').select });
    const res = await patchRequest(mock.db, { weekStarting: '2026-06-15' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for a malformed id', async () => {
    const mock = makeDbMock({});
    const res = await patchRequest(mock.db, { status: 'shopping' }, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(mock.writes).toHaveLength(0);
  });
});

describe('DELETE /api/shopping-lists/:id', () => {
  const del = (db: any, id = LIST_ID) =>
    shoppingListsRoutes(db).request(`/${id}`, { method: 'DELETE' });

  test('deletes a list and its items', async () => {
    const mock = makeDbMock({ txSelect: lockedList('draft').select });
    const res = await del(mock.db);
    expect(res.status).toBe(204);
    // Items first: list_id has no ON DELETE CASCADE, so the reverse order
    // would fail on the foreign key.
    expect(mock.writes.map((w) => w.table)).toEqual(['shopping_list_items', 'shopping_lists']);
  });

  test('returns 409 when deleting a done list', async () => {
    const mock = makeDbMock({ txSelect: lockedList('done').select });
    const res = await del(mock.db);
    expect(res.status).toBe(409);
    expect(mock.writes).toHaveLength(0);
  });

  test('returns 404 when deleting an unknown list', async () => {
    const mock = makeDbMock({ txSelect: makeSelectRouter([[shoppingLists, []]]).select });
    const res = await del(mock.db);
    expect(res.status).toBe(404);
    expect(mock.writes).toHaveLength(0);
  });

  test('returns 400 for a malformed id', async () => {
    const mock = makeDbMock({});
    const res = await del(mock.db, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(mock.writes).toHaveLength(0);
  });
});
