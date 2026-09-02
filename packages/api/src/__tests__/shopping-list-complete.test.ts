// Mock-based tests for POST /shopping-lists/:id/complete (file bought items to pantry)

import { describe, test, expect, vi } from 'vitest';
import { shoppingLists, shoppingListItems } from '@diet-app/db';
import { shoppingListCompleteRoutes } from '../routes/shopping-list-complete.js';
import { tableNameOf } from './drizzle-introspect.js';
import {
  LIST_ID,
  ITEM_BOUGHT_ID,
  ITEM_NO_SHELF_ID,
  LIST_DRAFT,
  ITEM_BOUGHT,
  ITEM_UNBOUGHT,
  ITEM_ZERO,
  ITEM_NO_SHELF,
  ING_NO_SHELF,
  makeCompleteMock,
  jsonReq,
} from './shopping-list-complete-mock.js';

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
  // callers must send at least `{}`, same as every write route here but
  // POST /cook, which shipped body-less and keeps accepting zero bytes.
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

  test('completes a list already in shopping status, filing pantry rows and setting done', async () => {
    const { db, pantryWrites, listWrites } = makeCompleteMock({
      list: { ...LIST_DRAFT, status: 'shopping' },
    });
    const res = await shoppingListCompleteRoutes(db).request(
      `/${LIST_ID}/complete`,
      jsonReq({}),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toHaveLength(1);
    expect(body.list.status).toBe('done');
    expect(pantryWrites()).toHaveLength(1);
    expect(listWrites()[0]!.values).toMatchObject({ status: 'done' });
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
    // Pin the clock so expiry is a fixed date: ING_PRODUCE has fridge_days:5
    // and freezer_days:180. A split-brain (location from override, expiry from
    // the produce→fridge default) would write 2026-08-09 instead of 2027-01-31.
    vi.useFakeTimers({ now: Date.UTC(2026, 7, 4), toFake: ['Date'] });
    try {
      const { db, pantryWrites } = makeCompleteMock();
      const res = await shoppingListCompleteRoutes(db).request(
        `/${LIST_ID}/complete`,
        jsonReq({ overrides: [{ itemId: ITEM_BOUGHT_ID, location: 'freezer' }] }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.added[0].location).toBe('freezer');
      expect(body.added[0].expiresDate).toBe('2027-01-31');
      expect(pantryWrites()[0]!.values).toMatchObject({
        location: 'freezer',
        expiresDate: '2027-01-31',
      });
    } finally {
      vi.useRealTimers();
    }
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
