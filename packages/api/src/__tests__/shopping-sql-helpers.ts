// Request and lookup helpers shared by the shopping-list real-Postgres suites

import { expect } from 'vitest';
import type { Hono } from 'hono';

/** Takes the possibly-null app of useRealDb callers; the suites skip when it is null. */
export function shoppingSqlHelpers(app: Hono | null) {
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

  return { json, findIngredient, itemFor };
}
