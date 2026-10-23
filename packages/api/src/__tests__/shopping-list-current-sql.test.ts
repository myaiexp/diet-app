// GET /shopping-lists/current against real Postgres: this week's list wins,
// an earlier week only while still open, a completed earlier week never.
// The clock is pinned to a far *past* week: every other suite's list then sits
// in a future week, which /current never returns, so none can compete.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { shoppingLists, shoppingListItems } from '@diet-app/db';
import { inArray } from 'drizzle-orm';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

// Wednesday of the pinned week; LAST and NEXT are the neighbouring Mondays.
const TODAY = '2001-03-14';
const THIS_MONDAY = '2001-03-12';
const LAST_MONDAY = '2001-03-05';
const NEXT_MONDAY = '2001-03-19';
const WEEKS = [THIS_MONDAY, LAST_MONDAY, NEXT_MONDAY];

describe.skipIf(!hasDb)('GET /api/shopping-lists/current', () => {
  async function clearWeeks() {
    const rows = await db!
      .select({ id: shoppingLists.id })
      .from(shoppingLists)
      .where(inArray(shoppingLists.weekStarting, WEEKS));
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    await db!.delete(shoppingListItems).where(inArray(shoppingListItems.listId, ids));
    await db!.delete(shoppingLists).where(inArray(shoppingLists.id, ids));
  }

  async function insertList(weekStarting: string, status: 'draft' | 'shopping' | 'done') {
    const [row] = await db!.insert(shoppingLists).values({ weekStarting, status }).returning();
    return row!;
  }

  async function current() {
    const res = await app!.request('/api/shopping-lists/current');
    return { status: res.status, body: (await res.json()) as { id?: string; weekStarting?: string } };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date(`${TODAY}T12:00:00.000Z`), toFake: ['Date'] });
    await clearWeeks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await clearWeeks();
  });

  test('a completed earlier week does not stand in for this week', async () => {
    await insertList(LAST_MONDAY, 'done');
    const res = await current();
    expect(res.status).toBe(404);
  });

  test("an earlier week's open list is returned while this week has none", async () => {
    const open = await insertList(LAST_MONDAY, 'shopping');
    const res = await current();
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(open.id);
  });

  test("this week's list wins over an open earlier one, even when done", async () => {
    await insertList(LAST_MONDAY, 'draft');
    const thisWeek = await insertList(THIS_MONDAY, 'done');
    const res = await current();
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(thisWeek.id);
  });

  test('a future-week draft is never current', async () => {
    await insertList(NEXT_MONDAY, 'draft');
    const res = await current();
    expect(res.status).toBe(404);
  });
});
