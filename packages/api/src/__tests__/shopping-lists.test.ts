// Mock-based route tests for shoppingListsRoutes — deterministic, Postgres-free.
// Splits the previously-vacuous integration assertion (expect([200,404]), which
// always passes) into explicit success and not-found cases.

import { describe, test, expect } from 'vitest';
import { shoppingListsRoutes } from '../routes/shopping-lists.js';

const LIST = {
  id: '11111111-1111-1111-1111-111111111111',
  weekStarting: '2026-06-15',
  status: 'draft',
  items: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      netToBuy: '2',
      category: 'produce',
      ingredient: { id: '33333333-3333-3333-3333-333333333333', name: 'Onion' },
    },
  ],
};

describe('shoppingListsRoutes', () => {
  test('GET /current returns 200 with the list and its items when one exists', async () => {
    const mockDb = { query: { shoppingLists: { findFirst: async () => LIST } } } as any;
    const app = shoppingListsRoutes(mockDb);
    const res = await app.request('/current');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(LIST.id);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items[0].ingredient.name).toBe('Onion');
  });

  test('GET /current returns 404 with error body when none exist', async () => {
    const mockDb = { query: { shoppingLists: { findFirst: async () => undefined } } } as any;
    const app = shoppingListsRoutes(mockDb);
    const res = await app.request('/current');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
