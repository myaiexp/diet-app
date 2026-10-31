// Real-Postgres smoke: ingredient search filters and the import name matcher's SQL

import { describe, test, expect } from 'vitest';
import { ingredients } from '@diet-app/db';
import { eq } from 'drizzle-orm';
import { matchIngredientNames } from '../ingredient-match.js';
import { createApp } from '../app.js';
import { useRealDb } from './real-db.js';

const { db, hasDb } = useRealDb();
const app = db ? createApp(db) : null;

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
    // An empty page satisfies the loop below, so a broken ILIKE would pass.
    expect(body.length).toBeGreaterThan(0);
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
    expect(body.length).toBeGreaterThan(0);
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
    expect(body.length).toBeGreaterThan(0);
    expect(body.map((i: { name: string }) => i.name)).toContain('chicken breast');
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

describe.skipIf(!hasDb)('matchIngredientNames SQL', () => {
  // Import injects a matcher in unit tests and 503s here without AI, so this is
  // the only place the production unnest(coalesce(aliases)) / lower(name) IN
  // query actually runs against Postgres.
  test('exact name, seeded alias, and none against dietapp_test', async () => {
    const [chicken, peruna, unicorn] = await matchIngredientNames(db!, [
      'chicken',
      'peruna',
      'unicorn',
    ]);

    const [chickenRow] = await db!
      .select({ id: ingredients.id, name: ingredients.name })
      .from(ingredients)
      .where(eq(ingredients.name, 'chicken'));
    const [potatoRow] = await db!
      .select({ id: ingredients.id, name: ingredients.name })
      .from(ingredients)
      .where(eq(ingredients.name, 'potato'));
    expect(chickenRow, 'seed should contain chicken').toBeDefined();
    expect(potatoRow, 'seed should contain potato (alias peruna)').toBeDefined();

    expect(chicken).toEqual({
      rawName: 'chicken',
      ingredientId: chickenRow!.id,
      ingredientName: chickenRow!.name,
      match: 'exact',
    });
    // An alias hit names the catalog row, not the alias that was searched for —
    // 'peruna' resolves to 'potato', which is what the review screen shows.
    expect(peruna).toEqual({
      rawName: 'peruna',
      ingredientId: potatoRow!.id,
      ingredientName: potatoRow!.name,
      match: 'alias',
    });
    expect(unicorn).toEqual({
      rawName: 'unicorn',
      ingredientId: null,
      ingredientName: null,
      match: 'none',
    });
  });
});
