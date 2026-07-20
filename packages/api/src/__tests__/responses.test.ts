// Unit tests for shared write response helpers and safe JSON body parsing.

import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import { badRequest, conflict, notFound } from '../responses.js';
import { readJsonBody } from '../json-body.js';

function appWith(handler: (c: any) => Response | Promise<Response>) {
  const app = new Hono();
  app.all('/', handler);
  return app;
}

describe('responses', () => {
  test('badRequest returns 400 with error and optional details', async () => {
    const app = appWith((c) => badRequest(c, 'Validation failed', { fieldErrors: { x: ['bad'] } }));
    const res = await app.request('/');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Validation failed',
      details: { fieldErrors: { x: ['bad'] } },
    });
  });

  test('badRequest omits details when not provided', async () => {
    const app = appWith((c) => badRequest(c, 'Invalid JSON body'));
    const res = await app.request('/');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  test('conflict returns 409 with error only', async () => {
    const app = appWith((c) => conflict(c, 'Recipe is referenced by meal plan entries'));
    const res = await app.request('/');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Recipe is referenced by meal plan entries',
    });
  });

  test('notFound returns 404 with standard body', async () => {
    const app = appWith((c) => notFound(c));
    const res = await app.request('/');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

describe('readJsonBody', () => {
  test('returns ok:true with parsed data for valid JSON', async () => {
    const app = appWith(async (c) => {
      const result = await readJsonBody(c);
      if (!result.ok) return result.response;
      return c.json({ got: result.data });
    });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: { a: 1 } });
  });

  test('returns ok:false for empty/non-JSON body', async () => {
    const app = appWith(async (c) => {
      const result = await readJsonBody(c);
      if (!result.ok) return result.response;
      return c.json({ got: result.data });
    });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });
});
