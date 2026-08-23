// getPagination clamp/fallback edges, driven through a tiny Hono app.

import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import { getPagination, DEFAULT_LIMIT, MAX_LIMIT } from '../pagination.js';

function paginationApp() {
  const app = new Hono();
  app.get('/', (c) => c.json(getPagination(c)));
  return app;
}

async function paginate(query = ''): Promise<{ limit: number; offset: number }> {
  const res = await paginationApp().request(`/${query}`);
  return res.json() as Promise<{ limit: number; offset: number }>;
}

describe('getPagination', () => {
  test('defaults: limit=DEFAULT_LIMIT, offset=0 when no params', async () => {
    expect(await paginate()).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  test('honours an explicit pair', async () => {
    expect(await paginate('?limit=10&offset=5')).toEqual({ limit: 10, offset: 5 });
  });

  test('clamps an over-large limit to MAX_LIMIT', async () => {
    expect(await paginate('?limit=9999')).toEqual({ limit: MAX_LIMIT, offset: 0 });
  });

  test('clamps limit=0 to 1 so an empty page is not mistaken for end-of-list', async () => {
    expect(await paginate('?limit=0')).toEqual({ limit: 1, offset: 0 });
  });

  test('clamps a negative limit to 1', async () => {
    expect(await paginate('?limit=-5')).toEqual({ limit: 1, offset: 0 });
  });

  test('clamps a negative offset to 0', async () => {
    expect(await paginate('?offset=-1')).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  test('falls back to DEFAULT_LIMIT on a non-integer limit', async () => {
    expect(await paginate('?limit=1.5')).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  test('falls back to DEFAULT_LIMIT on an empty limit', async () => {
    expect(await paginate('?limit=')).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  test('falls back to default on a non-numeric limit', async () => {
    expect(await paginate('?limit=abc')).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });
});
