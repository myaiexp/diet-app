// Mock-based tests for POST /shopping-lists/:id/complete (file bought items to pantry)

import { describe, test, expect, vi } from 'vitest';
import { shoppingLists, shoppingListItems, ingredients, pantryItems } from '@diet-app/db';
import { shoppingListCompleteRoutes } from '../routes/shopping-list-complete.js';
import { makeDbMock } from './db-mock.js';
import { makeSelectRouter } from './select-router.js';
import { tableNameOf } from './drizzle-introspect.js';

const LIST_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_BOUGHT_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_UNBOUGHT_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ZERO_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_NO_SHELF_ID = '55555555-5555-4555-8555-555555555555';
const ING_PRODUCE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ING_NO_SHELF_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

const LIST_DRAFT = {
  id: LIST_ID,
  weekStarting: '2026-08-03',
  status: 'draft',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

const ITEM_BOUGHT = {
  id: ITEM_BOUGHT_ID,
  listId: LIST_ID,
  ingredientId: ING_PRODUCE_ID,
  quantityNeeded: '500',
  quantityInPantry: '0',
  netToBuy: '500',
  category: 'produce',
  unit: 'g',
  source: 'generated',
  bought: true,
  customNote: null,
};

const ITEM_UNBOUGHT = { ...ITEM_BOUGHT, id: ITEM_UNBOUGHT_ID, bought: false };
const ITEM_ZERO = { ...ITEM_BOUGHT, id: ITEM_ZERO_ID, netToBuy: '0' };
const ITEM_NO_SHELF = {
  ...ITEM_BOUGHT,
  id: ITEM_NO_SHELF_ID,
  ingredientId: ING_NO_SHELF_ID,
  category: 'other',
};

const ING_PRODUCE = {
  id: ING_PRODUCE_ID,
  name: 'Carrot',
  category: 'produce',
  defaultUnit: 'g',
  shelfLife: { fridge_days: 5, freezer_days: 180 },
};

const ING_NO_SHELF = {
  id: ING_NO_SHELF_ID,
  name: 'Mystery item',
  category: 'other',
  defaultUnit: 'g',
  shelfLife: {},
};

type CompleteMockOpts = {
  list?: unknown | null;
  items?: unknown[];
  ingredientRows?: unknown[];
};

function makeCompleteMock(opts: CompleteMockOpts = {}) {
  const resolveList = () => (opts.list === undefined ? { ...LIST_DRAFT } : opts.list);

  const router = makeSelectRouter([
    [
      shoppingLists,
      () => {
        const list = resolveList();
        return list == null ? [] : [list];
      },
    ],
    [shoppingListItems, opts.items ?? [{ ...ITEM_BOUGHT }]],
    [ingredients, opts.ingredientRows ?? [{ ...ING_PRODUCE }]],
  ]);

  let pantrySeq = 0;
  const mock = makeDbMock({
    select: router.select,
    insertRows: (_recorded, record) => {
      pantrySeq += 1;
      return [
        {
          id: `pantry-${pantrySeq}`,
          createdAt: new Date('2026-08-04T00:00:00Z'),
          updatedAt: new Date('2026-08-04T00:00:00Z'),
          ...(record.values as object),
        },
      ];
    },
    updateRows: (_recorded, record) => [
      { ...resolveList(), ...(record.values as object) },
    ],
  });

  const writesTo = (table: unknown) =>
    mock.writes.filter((w) => w.table === tableNameOf(table));

  return {
    db: mock.db,
    writes: mock.writes,
    pantryWrites: () => writesTo(pantryItems),
    listWrites: () => writesTo(shoppingLists),
    reads: router.reads,
  };
}

function jsonReq(body?: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

describe('shoppingListCompleteRoutes', () => {
  test('returns 400 for a malformed id without touching the db', async () => {
    let opened = false;
    const db = { transaction: async () => { opened = true; } } as any;
    const res = await shoppingListCompleteRoutes(db).request(
      '/not-a-uuid/complete',
      jsonReq({}),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid id format' });
    expect(opened).toBe(false);
  });

  // Decision: overrides is optional in the schema, but c.req.json() throws on
  // a truly bodyless request. We don't special-case that into "no overrides" —
  // callers must send at least `{}`, same as every other write route here.
  test('returns 400 for a request with no body at all', async () => {
    const { db } = makeCompleteMock();
    const res = await shoppingListCompleteRoutes(db).request(`/${LIST_ID}/complete`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  test('returns 400 for a malformed override body', async () => {
    const { db } = makeCompleteMock();
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({ overrides: [{ itemId: 'not-a-uuid', location: 'fridge' }] }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  test('returns 404 for an unknown list', async () => {
    const { db } = makeCompleteMock({ list: null });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  test('returns 409 when the list is already done', async () => {
    const { db } = makeCompleteMock({ list: { ...LIST_DRAFT, status: 'done' } });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Shopping list already completed' });
  });

  test('creates pantry rows for bought items with net to buy', async () => {
    const { db, pantryWrites } = makeCompleteMock();
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toHaveLength(1);
    expect(body.skipped).toEqual([]);
    expect(pantryWrites()).toHaveLength(1);
  });

  test('uses the item unit and netToBuy as the pantry quantity', async () => {
    const { db } = makeCompleteMock({
      items: [{ ...ITEM_BOUGHT, netToBuy: '750', unit: 'g' }],
    });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    const body = await res.json();
    expect(body.added[0]).toMatchObject({ quantity: '750', unit: 'g' });
  });

  test('infers location from the item category', async () => {
    const { db, pantryWrites } = makeCompleteMock();
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    // produce -> fridge (pantry-location.ts)
    expect(pantryWrites()[0]!.values).toMatchObject({ location: 'fridge' });
  });

  test('applies a per-item location override', async () => {
    const { db, pantryWrites } = makeCompleteMock();
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({ overrides: [{ itemId: ITEM_BOUGHT_ID, location: 'freezer' }] }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added[0].location).toBe('freezer');
    expect(pantryWrites()[0]!.values).toMatchObject({ location: 'freezer' });
  });

  test('derives expiresDate from the ingredient shelf life for that location', async () => {
    // Pin the clock: the handler stamps addedDate/expiresDate from new Date()
    // inside the request. Recomputing "today" after await can straddle UTC
    // midnight; fake Date is enough (don't stub timers — Hono's request is
    // promise-based).
    vi.useFakeTimers({ now: Date.UTC(2026, 7, 4), toFake: ['Date'] });
    try {
      const { db } = makeCompleteMock();
      const res = await shoppingListCompleteRoutes(db).request(
        `/${LIST_ID}/complete`,
        jsonReq({}),
      );
      const body = await res.json();
      expect(body.added[0].addedDate).toBe('2026-08-04');
      expect(body.added[0].expiresDate).toBe('2026-08-09'); // fridge_days: 5
    } finally {
      vi.useRealTimers();
    }
  });

  test('skips items whose shelf life has no entry for the location, reported not fatal', async () => {
    const { db, pantryWrites } = makeCompleteMock({
      items: [{ ...ITEM_NO_SHELF }],
      ingredientRows: [{ ...ING_NO_SHELF }],
    });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual([]);
    expect(body.skipped).toEqual([{ itemId: ITEM_NO_SHELF_ID, reason: 'no_shelf_life' }]);
    expect(pantryWrites()).toHaveLength(0);
    // The list still transitions to done — a skip is not fatal.
    expect(body.list.status).toBe('done');
  });

  test('ignores unbought items', async () => {
    const { db } = makeCompleteMock({
      items: [{ ...ITEM_UNBOUGHT }],
    });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual([]);
    expect(body.skipped).toEqual([]);
  });

  test('ignores bought items whose netToBuy is zero', async () => {
    const { db } = makeCompleteMock({
      items: [{ ...ITEM_ZERO }],
    });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual([]);
    expect(body.skipped).toEqual([]);
  });

  test('sets the list status to done', async () => {
    const { db, listWrites } = makeCompleteMock();
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.list.status).toBe('done');
    expect(listWrites()).toHaveLength(1);
    expect(listWrites()[0]!.values).toMatchObject({ status: 'done' });
  });

  test('completes a list with no bought items, adding nothing', async () => {
    const { db, listWrites, pantryWrites } = makeCompleteMock({ items: [] });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual([]);
    expect(body.skipped).toEqual([]);
    expect(body.list.status).toBe('done');
    expect(pantryWrites()).toHaveLength(0);
    expect(listWrites()).toHaveLength(1);
  });

  test('locks the list row with FOR UPDATE', async () => {
    const { db, reads } = makeCompleteMock();
    await shoppingListCompleteRoutes(db).request(`/${LIST_ID}/complete`, jsonReq({}));
    const listRead = reads.find((r) => r.table === tableNameOf(shoppingLists));
    expect(listRead?.forUpdate).toBe(true);
  });

  test('locks the item rows FOR UPDATE after the list', async () => {
    const { db, reads } = makeCompleteMock();
    await shoppingListCompleteRoutes(db).request(`/${LIST_ID}/complete`, jsonReq({}));
    const listIdx = reads.findIndex((r) => r.table === tableNameOf(shoppingLists));
    const itemIdx = reads.findIndex((r) => r.table === tableNameOf(shoppingListItems));
    expect(itemIdx).toBeGreaterThan(listIdx);
    expect(reads[itemIdx]?.forUpdate).toBe(true);
  });
});
