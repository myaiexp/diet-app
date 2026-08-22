import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
// Resolved from this file, not the CWD: a CWD-relative path silently loads
// nothing when vitest is invoked from the repo root instead of packages/api,
// which puts the whole suite back into silent-skip mode.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

import { describe, test, expect, afterAll } from 'vitest';
import {
  createDb,
  cookFeedback,
  shoppingLists,
  shoppingListItems,
  pantryItems,
} from '@diet-app/db';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../app.js';
// Asserted through the production predicate rather than a literal error shape:
// Drizzle wraps driver errors, and what matters is that the routes' own
// mapping recognizes the violation — not which wrapper this version uses.
import { isUniqueViolation } from '../pg-errors.js';

// Integration suite — exercises every route against a REAL Postgres instance
// (dietapp_test). It is GATED on TEST_DATABASE_URL: when that env var is absent
// (e.g. CI with no provisioned Postgres) the whole suite is skipped rather than
// crashing the process at import, so the mock-based unit suites in this dir
// (ingredients/pantry/recipes/meal-plans/shopping-lists.test.ts) still run and
// verify route logic Postgres-free. Deterministic 200-path and field-shape
// coverage lives in those unit suites; this suite is a real-schema smoke check.
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// SAFETY: never let the integration suite point at production. If a URL is set
// and it looks like the prod database — contains 'dietapp' without the '_test'
// suffix — hard-fail before opening any connection. (The error intentionally
// omits the URL, to avoid leaking any credentials embedded in a bad value.)
if (TEST_DB_URL && TEST_DB_URL.includes('dietapp') && !TEST_DB_URL.includes('_test')) {
  throw new Error(
    "Refusing to run tests: TEST_DATABASE_URL looks like the production database " +
      "(contains 'dietapp' but not '_test'). Point it at dietapp_test before running tests."
  );
}

const hasDb = Boolean(TEST_DB_URL);
const db = hasDb ? createDb(TEST_DB_URL!) : null;
const app = db ? createApp(db) : null;

// LOUD GATE: `describe.skipIf` alone reports 19 quiet skips, which is how this
// suite went 4 commits without ever executing — the SQL it is the only cover
// for (tags @>, unnest, ON CONFLICT, relational with:, numeric FEFO math) was
// unverified the whole time. An unset TEST_DATABASE_URL now fails the run.
// Opting out is possible but has to be deliberate: DIET_APP_SKIP_DB_TESTS=1.
// The db package has the same gate over its 4 import-products-sql tests.
const SKIP_DB_TESTS = process.env.DIET_APP_SKIP_DB_TESTS === '1';

describe('integration DB gate', () => {
  test.skipIf(SKIP_DB_TESTS)('TEST_DATABASE_URL is configured', () => {
    expect(
      hasDb,
      'TEST_DATABASE_URL is not set, so the entire real-Postgres integration ' +
        'suite would skip silently. Provision the DB with ' +
        '`pnpm --filter @diet-app/db setup:test-db`, then add TEST_DATABASE_URL ' +
        'to the repo-root .env (see .env.example). To run the mock suites ' +
        'without Postgres on purpose, set DIET_APP_SKIP_DB_TESTS=1.',
    ).toBe(true);
  });
});

// Write-path smokes mutate dietapp_test and clean up in try/finally so leftover
// rows do not accumulate across runs. The DB is isolated from prod (guarded
// above), so writes here are safe regardless.

afterAll(async () => {
  // Close the underlying pg pool so the test process exits cleanly.
  await db?.$client.end();
});

describe.skipIf(!hasDb)('GET /api/ingredients', () => {
  test('returns array', async () => {
    const res = await app!.request('/api/ingredients');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('?q=chicken returns filtered results', async () => {
    const res = await app!.request('/api/ingredients?q=chicken');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Each result should match chicken in name or aliases
    for (const item of body) {
      const nameMatch = item.name.toLowerCase().includes('chicken');
      const aliasMatch = (item.aliases ?? []).some((a: string) =>
        a.toLowerCase().includes('chicken')
      );
      expect(nameMatch || aliasMatch).toBe(true);
    }
  });

  test('?category=produce returns only produce', async () => {
    const res = await app!.request('/api/ingredients?category=produce');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const item of body) {
      expect(item.category).toBe('produce');
    }
  });

  // Finding #5: ?q + ?category exercises the and(...) combined SQL path that the
  // single-filter tests above never hit. Every row must satisfy BOTH filters.
  test('?q + ?category returns rows satisfying both filters', async () => {
    const res = await app!.request('/api/ingredients?q=chicken&category=protein');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const item of body) {
      expect(item.category).toBe('protein');
      const nameMatch = item.name.toLowerCase().includes('chicken');
      const aliasMatch = (item.aliases ?? []).some((a: string) =>
        a.toLowerCase().includes('chicken')
      );
      expect(nameMatch || aliasMatch).toBe(true);
    }
  });

  test('?limit caps the number of rows returned', async () => {
    const res = await app!.request('/api/ingredients?limit=5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(5);
  });

  test('/:id returns 404 for missing', async () => {
    const res = await app!.request('/api/ingredients/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!hasDb)('GET /api/recipes', () => {
  test('returns array', async () => {
    const res = await app!.request('/api/recipes');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe.skipIf(!hasDb)('recipe write cycle', () => {
  test('ingredient from seed → POST → GET → PATCH → DELETE', async () => {
    const ingredientsRes = await app!.request('/api/ingredients?limit=1');
    expect(ingredientsRes.status).toBe(200);
    const ingredients = await ingredientsRes.json();
    expect(ingredients.length).toBeGreaterThan(0);
    const ingredientId = ingredients[0].id as string;

    let recipeId: string | undefined;
    try {
      const createRes = await app!.request('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Integration smoke recipe',
          servings: 2,
          ingredients: [{ ingredientId, quantity: 100, unit: 'g' }],
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      recipeId = created.id;
      expect(created.recipeIngredients).toHaveLength(1);

      const getRes = await app!.request(`/api/recipes/${recipeId}`);
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).title).toBe('Integration smoke recipe');

      const scaleRes = await app!.request(`/api/recipes/${recipeId}?servings=2`);
      expect(scaleRes.status).toBe(200);
      const scaled = await scaleRes.json();
      expect(scaled.servings).toBe(2);
      expect(scaled.baseServings).toBe(2);
      expect(typeof scaled.recipeIngredients[0].quantity).toBe('string');
      expect(scaled.recipeIngredients[0].quantity).toBe('100');

      const patchRes = await app!.request(`/api/recipes/${recipeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated smoke recipe' }),
      });
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).title).toBe('Updated smoke recipe');
    } finally {
      if (recipeId) {
        const delRes = await app!.request(`/api/recipes/${recipeId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delRes.status);
      }
    }
  });
});

describe.skipIf(!hasDb)('POST /api/recipes/import', () => {
  // createApp(db) without ai config → import must 503 (no real AI keys in CI).
  test('returns 503 when AI is not configured', async () => {
    const res = await app!.request('/api/recipes/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '1 cup flour\nBake bread' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'AI not configured' });
  });
});

describe.skipIf(!hasDb)('GET /api/pantry', () => {
  test('returns array with status field', async () => {
    const res = await app!.request('/api/pantry');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const validStatuses = ['fresh', 'use_soon', 'use_today', 'expired'];
    for (const item of body) {
      expect(validStatuses).toContain(item.status);
    }
  });
});

describe.skipIf(!hasDb)('pantry write cycle', () => {
  test('resolve ingredient → POST → GET → PATCH → DELETE', async () => {
    const ingredientsRes = await app!.request('/api/ingredients?limit=1');
    expect(ingredientsRes.status).toBe(200);
    const ingredients = await ingredientsRes.json();
    expect(ingredients.length).toBeGreaterThan(0);
    const ingredientId = ingredients[0].id as string;

    let itemId: string | undefined;
    try {
      const createRes = await app!.request('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId,
          quantity: 2,
          unit: 'pcs',
          location: 'fridge',
          expiresDate: '2099-12-31',
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      itemId = created.id;
      expect(created.status).toBeDefined();
      expect(created.quantity).toBe('2');

      const getRes = await app!.request(`/api/pantry/${itemId}`);
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).id).toBe(itemId);

      const patchRes = await app!.request(`/api/pantry/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 5, unit: 'pcs' }),
      });
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).quantity).toBe('5');
    } finally {
      if (itemId) {
        const delRes = await app!.request(`/api/pantry/${itemId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delRes.status);
      }
    }
  });
});

describe.skipIf(!hasDb)('GET /api/profile', () => {
  test('returns user profile', async () => {
    const res = await app!.request('/api/profile');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
    expect(Array.isArray(body.dislikedIngredientIds)).toBe(true);
  });
});

describe.skipIf(!hasDb)('PATCH /api/profile', () => {
  test('updates householdSize on real DB and restores', async () => {
    const getRes = await app!.request('/api/profile');
    expect(getRes.status).toBe(200);
    const before = await getRes.json();
    const originalSize = before.householdSize as number;
    const nextSize = originalSize === 1 ? 2 : 1;

    try {
      const patchRes = await app!.request('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdSize: nextSize }),
      });
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.householdSize).toBe(nextSize);
      expect(Array.isArray(patched.dislikedIngredientIds)).toBe(true);
    } finally {
      const restore = await app!.request('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdSize: originalSize }),
      });
      expect(restore.status).toBe(200);
      expect((await restore.json()).householdSize).toBe(originalSize);
    }
  });
});

describe.skipIf(!hasDb)('GET /api/shopping-lists', () => {
  // Real-schema contract check: whichever branch the test DB produces, assert the
  // matching body shape (not just the status). Deterministic 200/404 coverage is
  // in shopping-lists.test.ts.
  test('/current returns a list (200) or a not-found error (404)', async () => {
    const res = await app!.request('/api/shopping-lists/current');
    const body = await res.json();
    if (res.status === 200) {
      expect(body).toHaveProperty('id');
      expect(Array.isArray(body.items)).toBe(true);
    } else {
      expect(res.status).toBe(404);
      expect(body).toEqual({ error: 'Not found' });
    }
  });
});

describe.skipIf(!hasDb)('shopping list flow', () => {
  // Thursday; generate must snap it back to Monday 2026-09-07.
  const MID_WEEK = '2026-09-10';
  const MONDAY = '2026-09-07';

  const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const findIngredient = async (q: string) => {
    const res = await app!.request(`/api/ingredients?q=${q}&limit=1`);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.length, `seed should contain an ingredient matching "${q}"`).toBeGreaterThan(0);
    return rows[0] as { id: string; name: string; category: string };
  };

  const itemFor = (items: any[], ingredientId: string, unit: string) =>
    items.find((i) => i.ingredientId === ingredientId && i.unit === unit);

  test('generate → tick → hand-add → regenerate → complete round trip', async () => {
    const apple = await findIngredient('apple'); // produce, pieces
    const artichoke = await findIngredient('artichoke'); // produce, g
    const banana = await findIngredient('banana'); // the manual add
    const ingredientIds = [apple.id, artichoke.id, banana.id];

    let recipeId: string | undefined;
    let entryId: string | undefined;
    let listId: string | undefined;

    try {
      // Leftovers from an interrupted run would skew the pantry netting below.
      await db!.delete(pantryItems).where(inArray(pantryItems.ingredientId, ingredientIds));
      const stale = await db!
        .select({ id: shoppingLists.id })
        .from(shoppingLists)
        .where(eq(shoppingLists.weekStarting, MONDAY));
      for (const row of stale) {
        await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, row.id));
        await db!.delete(shoppingLists).where(eq(shoppingLists.id, row.id));
      }

      // 1. Recipe (servings 2): 2 pieces apple + 400 g artichoke.
      const recipeRes = await app!.request(
        '/api/recipes',
        json('POST', {
          title: 'Shopping-list smoke recipe',
          servings: 2,
          ingredients: [
            { ingredientId: apple.id, quantity: 2, unit: 'pieces' },
            { ingredientId: artichoke.id, quantity: 400, unit: 'g' },
          ],
        }),
      );
      expect(recipeRes.status).toBe(201);
      recipeId = (await recipeRes.json()).id as string;

      // 2. One planned dinner at servings 4 → scale 2 → 4 pieces + 800 g.
      const entryRes = await app!.request(
        '/api/meal-plans',
        json('POST', { date: MID_WEEK, slot: 'dinner', recipeId, servings: 4 }),
      );
      expect(entryRes.status).toBe(201);
      entryId = (await entryRes.json()).id as string;

      // 3. 100 g of artichoke already in the pantry → netToBuy 700, not 800.
      const pantryRes = await app!.request(
        '/api/pantry',
        json('POST', {
          ingredientId: artichoke.id,
          quantity: 100,
          unit: 'g',
          location: 'fridge',
          expiresDate: '2099-12-31',
        }),
      );
      expect(pantryRes.status).toBe(201);

      // 4. Generate — the mid-week date snaps to the ISO Monday.
      const genRes = await app!.request('/api/shopping-lists/generate', json('POST', { weekStarting: MID_WEEK }));
      expect(genRes.status).toBe(200);
      const generated = await genRes.json();
      listId = generated.list.id as string;
      expect(generated.list.weekStarting).toBe(MONDAY);
      expect(generated.skipped).toEqual([]);

      const appleItem = itemFor(generated.items, apple.id, 'pieces');
      const artichokeItem = itemFor(generated.items, artichoke.id, 'g');
      expect(appleItem, 'apple row in pieces').toBeDefined();
      expect(appleItem.netToBuy).toBe('4');
      expect(appleItem.source).toBe('generated');
      // Real pantry netting, computed by Postgres numerics round-tripping
      // through the aggregator — the half mocks structurally cannot prove.
      expect(artichokeItem.quantityNeeded).toBe('800');
      expect(artichokeItem.quantityInPantry).toBe('100');
      expect(artichokeItem.netToBuy).toBe('700');

      // 5. Tick the apple off and hand-add a banana in kg.
      const tick = await app!.request(
        `/api/shopping-lists/items/${appleItem.id}`,
        json('PATCH', { bought: true, customNote: 'the big ones' }),
      );
      expect(tick.status).toBe(200);

      const manual = await app!.request(
        `/api/shopping-lists/${listId}/items`,
        json('POST', { ingredientId: banana.id, quantityNeeded: 1, unit: 'kg' }),
      );
      expect(manual.status).toBe(201);
      const manualItem = await manual.json();
      // Normalized before the write, which is what lets the unique index see a
      // kg add and a generated g row as the same thing.
      expect(manualItem.unit).toBe('g');
      expect(manualItem.quantityNeeded).toBe('1000');
      expect(manualItem.source).toBe('manual');
      expect(manualItem.category).toBe(banana.category);

      // 6. A kg add against the existing g row must collide, not duplicate.
      const dupe = await app!.request(
        `/api/shopping-lists/${listId}/items`,
        json('POST', { ingredientId: artichoke.id, quantityNeeded: 1, unit: 'kg' }),
      );
      expect(dupe.status).toBe(409);

      // 7. Skip the dinner, then regenerate: the plan now calls for nothing.
      const skip = await app!.request(`/api/meal-plans/${entryId}`, json('PATCH', { status: 'skipped' }));
      expect(skip.status).toBe(200);

      const regen = await app!.request('/api/shopping-lists/generate', json('POST', { weekStarting: MONDAY }));
      expect(regen.status).toBe(200);
      const regenerated = await regen.json();
      expect(regenerated.list.id).toBe(listId);

      // The bought row survives (that food is still going in the basket) and
      // keeps its note; the manual row was never generation's to prune; the
      // unbought generated row is gone.
      const appleAfter = itemFor(regenerated.items, apple.id, 'pieces');
      expect(appleAfter, 'bought generated row must survive a regeneration').toBeDefined();
      expect(appleAfter.bought).toBe(true);
      expect(appleAfter.customNote).toBe('the big ones');
      expect(itemFor(regenerated.items, banana.id, 'g'), 'manual row must survive').toBeDefined();
      expect(itemFor(regenerated.items, artichoke.id, 'g'), 'unbought generated row is pruned').toBeUndefined();

      // 8. Complete: bought items with netToBuy > 0 become real pantry rows.
      const buyManual = await app!.request(
        `/api/shopping-lists/items/${manualItem.id}`,
        json('PATCH', { bought: true }),
      );
      expect(buyManual.status).toBe(200);

      const done = await app!.request(`/api/shopping-lists/${listId}/complete`, json('POST', {}));
      expect(done.status).toBe(200);
      const completed = await done.json();
      expect(completed.list.status).toBe('done');
      expect(completed.skipped).toEqual([]);
      expect(completed.added).toHaveLength(2);

      // produce → fridge → shelfLife.fridge_days (7 in the seed data).
      const today = new Date().toISOString().slice(0, 10);
      const expected = new Date(`${today}T00:00:00.000Z`);
      expected.setUTCDate(expected.getUTCDate() + 7);
      const expectedExpiry = expected.toISOString().slice(0, 10);

      const addedApple = completed.added.find((r: any) => r.ingredientId === apple.id);
      expect(addedApple.quantity).toBe('4');
      expect(addedApple.unit).toBe('pieces');
      expect(addedApple.location).toBe('fridge');
      expect(addedApple.expiresDate).toBe(expectedExpiry);

      const pantryList = await app!.request('/api/pantry?limit=200');
      const pantryRows = await pantryList.json();
      expect(pantryRows.some((r: any) => r.ingredientId === banana.id && r.quantity === '1000')).toBe(true);

      // 9. done is terminal: no second completion, no delete, no status flip,
      // and no item-level mutation that would desync the purchase record from
      // the pantry rows /complete just wrote.
      const again = await app!.request(`/api/shopping-lists/${listId}/complete`, json('POST', {}));
      expect(again.status).toBe(409);

      const reopen = await app!.request(`/api/shopping-lists/${listId}`, json('PATCH', { status: 'shopping' }));
      expect(reopen.status).toBe(409);

      const del = await app!.request(`/api/shopping-lists/${listId}`, { method: 'DELETE' });
      expect(del.status).toBe(409);

      const patchItem = await app!.request(
        `/api/shopping-lists/items/${appleItem.id}`,
        json('PATCH', { bought: false }),
      );
      expect(patchItem.status).toBe(409);

      const delItem = await app!.request(`/api/shopping-lists/items/${appleItem.id}`, {
        method: 'DELETE',
      });
      expect(delItem.status).toBe(409);

      const addItem = await app!.request(
        `/api/shopping-lists/${listId}/items`,
        json('POST', { ingredientId: banana.id, quantityNeeded: 1, unit: 'g' }),
      );
      expect(addItem.status).toBe(409);
    } finally {
      await db!.delete(pantryItems).where(inArray(pantryItems.ingredientId, ingredientIds));
      if (listId) {
        await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, listId));
        await db!.delete(shoppingLists).where(eq(shoppingLists.id, listId));
      }
      if (entryId) {
        const delEntry = await app!.request(`/api/meal-plans/${entryId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delEntry.status);
      }
      if (recipeId) {
        const delRecipe = await app!.request(`/api/recipes/${recipeId}`, { method: 'DELETE' });
        expect([204, 404]).toContain(delRecipe.status);
      }
    }
  });

  // The two constraints the merge model rests on. A mock cannot prove an index
  // exists — only Postgres refusing the second row can.
  test('enforces the (list_id, ingredient_id, unit) unique index at the DB level', async () => {
    const apple = await findIngredient('apple');
    const [list] = await db!.insert(shoppingLists).values({ weekStarting: '2026-09-21' }).returning();
    try {
      const row = {
        listId: list!.id,
        ingredientId: apple.id,
        quantityNeeded: '1',
        netToBuy: '1',
        category: apple.category,
        unit: 'pieces',
      };
      await db!.insert(shoppingListItems).values(row);
      await expect(db!.insert(shoppingListItems).values(row)).rejects.toSatisfy(isUniqueViolation);
    } finally {
      await db!.delete(shoppingListItems).where(eq(shoppingListItems.listId, list!.id));
      await db!.delete(shoppingLists).where(eq(shoppingLists.id, list!.id));
    }
  });

  test('enforces the week_starting unique index at the DB level', async () => {
    const [list] = await db!.insert(shoppingLists).values({ weekStarting: '2026-09-28' }).returning();
    try {
      await expect(
        db!.insert(shoppingLists).values({ weekStarting: '2026-09-28' }),
      ).rejects.toSatisfy(isUniqueViolation);
    } finally {
      await db!.delete(shoppingLists).where(eq(shoppingLists.id, list!.id));
    }
  });
});

describe.skipIf(!hasDb)('GET /api/meal-plans', () => {
  // Real-schema contract check: every returned entry has date/slot/status.
  // Deterministic populated-week coverage is in meal-plans.test.ts.
  test('/week/:date returns week entries with the expected shape', async () => {
    const res = await app!.request('/api/meal-plans/week/2026-03-05');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const entry of body) {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('slot');
      expect(entry).toHaveProperty('status');
    }
  });
});

describe.skipIf(!hasDb)('cook flow', () => {
  test('cooking an entry deducts pantry stock and increments timesCooked', async () => {
    // 1. Real ingredient id from seed (never hardcode UUIDs)
    const ingredientsRes = await app!.request('/api/ingredients?limit=1');
    expect(ingredientsRes.status).toBe(200);
    const ingredients = await ingredientsRes.json();
    expect(ingredients.length).toBeGreaterThan(0);
    const ingredientId = ingredients[0].id as string;

    let recipeId: string | undefined;
    let pantryId: string | undefined;
    let entryId: string | undefined;

    try {
      // 2. Recipe: servings 2, one line 500 g
      const recipeRes = await app!.request('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Cook-flow smoke recipe',
          servings: 2,
          ingredients: [{ ingredientId, quantity: 500, unit: 'g' }],
        }),
      });
      expect(recipeRes.status).toBe(201);
      recipeId = (await recipeRes.json()).id as string;

      // 3. Pantry: 1 kg of same ingredient (explicit expiresDate)
      const pantryRes = await app!.request('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId,
          quantity: 1,
          unit: 'kg',
          location: 'pantry',
          expiresDate: '2099-12-31',
        }),
      });
      expect(pantryRes.status).toBe(201);
      pantryId = (await pantryRes.json()).id as string;

      // 4. Meal plan entry: servings 2, dinner
      const entryRes = await app!.request('/api/meal-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: '2026-07-20',
          slot: 'dinner',
          recipeId,
          servings: 2,
        }),
      });
      expect(entryRes.status).toBe(201);
      entryId = (await entryRes.json()).id as string;

      // 5. Cook → 200, cooked, no shortfalls
      const cookRes = await app!.request(`/api/meal-plans/${entryId}/cook`, {
        method: 'POST',
      });
      expect(cookRes.status).toBe(200);
      const cookBody = await cookRes.json();
      expect(cookBody.entry.status).toBe('cooked');
      expect(cookBody.shortfalls).toEqual([]);

      // 6. Pantry quantity 1 kg → 0.5 kg (scale = 2/2 = 1; 500 g from 1 kg)
      const pantryGet = await app!.request(`/api/pantry/${pantryId}`);
      expect(pantryGet.status).toBe(200);
      expect((await pantryGet.json()).quantity).toBe('0.5');

      // 7. timesCooked === 1
      const recipeGet = await app!.request(`/api/recipes/${recipeId}`);
      expect(recipeGet.status).toBe(200);
      expect((await recipeGet.json()).timesCooked).toBe(1);

      // 8. Second cook → 409
      const reCook = await app!.request(`/api/meal-plans/${entryId}/cook`, {
        method: 'POST',
      });
      expect(reCook.status).toBe(409);
      expect(await reCook.json()).toEqual({
        error: 'Meal plan entry already cooked',
      });

      // 8b. PATCH cannot rewrite the inputs the deduction was computed from.
      // Each rejection must leave the pantry exactly where the cook left it.
      for (const patch of [
        { servings: 4 },
        { substituteRecipeId: recipeId },
        { servings: 4, notes: 'should not land' },
      ]) {
        const bad = await app!.request(`/api/meal-plans/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        expect(bad.status, `expected 409 for ${JSON.stringify(patch)}`).toBe(409);
        expect(await bad.json()).toEqual({
          error: 'Cooked meal plan entry recipe and servings are immutable',
        });
      }
      const pantryAfterPatch = await app!.request(`/api/pantry/${pantryId}`);
      expect((await pantryAfterPatch.json()).quantity).toBe('0.5');

      // 8c. …but the non-cook fields, and an unchanged resend, still go through.
      const okPatch = await app!.request(`/api/meal-plans/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servings: 2, recipeId, notes: 'a bit salty' }),
      });
      expect(okPatch.status).toBe(200);
      const patched = await okPatch.json();
      expect(patched.notes).toBe('a bit salty');
      expect(patched.status).toBe('cooked');

      // 9. Feedback create + get
      const fbRes = await app!.request(`/api/meal-plans/${entryId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: 'thumbs_up',
          effortCheck: 'felt_right',
          makeAgain: 'yes',
          usedAsIs: true,
        }),
      });
      expect(fbRes.status).toBe(201);
      const fbGet = await app!.request(`/api/meal-plans/${entryId}/feedback`);
      expect(fbGet.status).toBe(200);
      expect((await fbGet.json()).rating).toBe('thumbs_up');

      // 9b. The usedAsIs/changesNote pair round-trips through Postgres: the row
      // that comes back has to be the pair the handler validated, including on
      // a patch that names neither field.
      const patchFeedback = async (body: unknown) =>
        app!.request(`/api/meal-plans/${entryId}/feedback`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

      const withNote = await patchFeedback({ usedAsIs: false, changesNote: 'less salt' });
      expect(withNote.status).toBe(200);
      expect(await withNote.json()).toMatchObject({
        usedAsIs: false,
        changesNote: 'less salt',
      });

      // Only the rating changes — the stored pair must survive untouched.
      const ratingOnly = await patchFeedback({ rating: 'thumbs_down' });
      expect(ratingOnly.status).toBe(200);
      expect(await ratingOnly.json()).toMatchObject({
        rating: 'thumbs_down',
        usedAsIs: false,
        changesNote: 'less salt',
      });

      // Flipping back to "cooked as written" drops the note it no longer allows.
      const cleared = await patchFeedback({ usedAsIs: true });
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({ usedAsIs: true, changesNote: null });

      // A note sent alongside usedAsIs:true is a contradiction, not an auto-clear.
      const contradiction = await patchFeedback({ usedAsIs: true, changesNote: 'x' });
      expect(contradiction.status).toBe(400);
      const stillCleared = await app!.request(`/api/meal-plans/${entryId}/feedback`);
      expect(await stillCleared.json()).toMatchObject({
        usedAsIs: true,
        changesNote: null,
      });
    } finally {
      // feedback has no DELETE route — remove via db before entry delete
      if (entryId && db) {
        await db.delete(cookFeedback).where(eq(cookFeedback.mealPlanEntryId, entryId));
        const delEntry = await app!.request(`/api/meal-plans/${entryId}`, {
          method: 'DELETE',
        });
        expect([204, 404]).toContain(delEntry.status);
      }
      if (recipeId) {
        const delRecipe = await app!.request(`/api/recipes/${recipeId}`, {
          method: 'DELETE',
        });
        expect([204, 404]).toContain(delRecipe.status);
      }
      if (pantryId) {
        const delPantry = await app!.request(`/api/pantry/${pantryId}`, {
          method: 'DELETE',
        });
        expect([204, 404]).toContain(delPantry.status);
      }
    }
  });
});
