// Unit tests for shared write response helpers and safe JSON body parsing.

import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  badRequest,
  badGateway,
  conflict,
  forbidden,
  notFound,
  payloadTooLarge,
  serviceUnavailable,
  unsupportedMediaType,
} from '../responses.js';
import { parseJsonBody, type ParseJsonBodyOpts } from '../json-body.js';

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

  test('badGateway returns 502 and error body', async () => {
    const app = appWith((c) => badGateway(c, 'Failed to fetch URL'));
    const res = await app.request('/');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to fetch URL' });
  });

  test('serviceUnavailable returns 503 and error body', async () => {
    const app = appWith((c) => serviceUnavailable(c, 'AI not configured'));
    const res = await app.request('/');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'AI not configured' });
  });

  test('payloadTooLarge returns 413 and error body', async () => {
    const app = appWith((c) => payloadTooLarge(c));
    const res = await app.request('/');
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Request body too large' });
  });

  test('forbidden returns 403 and error body', async () => {
    const app = appWith((c) => forbidden(c));
    const res = await app.request('/');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  test('unsupportedMediaType returns 415 and the JSON Content-Type demand', async () => {
    const app = appWith((c) => unsupportedMediaType(c));
    const res = await app.request('/');
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' });
  });
});

describe('parseJsonBody', () => {
  const schema = z.object({ a: z.number().optional() }).strict();

  function postBody(body: string, opts?: ParseJsonBodyOpts) {
    const app = appWith(async (c) => {
      const parsed = await parseJsonBody(c, schema, opts);
      if (!parsed.ok) return parsed.response;
      return c.json({ got: parsed.data });
    });
    return app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }

  test('returns ok:true with parsed data for valid JSON', async () => {
    const res = await postBody(JSON.stringify({ a: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: { a: 1 } });
  });

  test('returns ok:false for empty/non-JSON body', async () => {
    const res = await postBody('not-json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  test('returns 400 with flattened Zod details when the schema rejects', async () => {
    const res = await postBody(JSON.stringify({ a: 'nope' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { fieldErrors: unknown } };
    expect(body.error).toBe('Validation failed');
    expect(body.details.fieldErrors).toHaveProperty('a');
  });

  test('requireNonEmpty rejects {} with Empty patch body', async () => {
    const res = await postBody('{}', { requireNonEmpty: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Validation failed',
      details: { formErrors: ['Empty patch body'] },
    });
  });

  test('{} passes when requireNonEmpty is not set', async () => {
    const res = await postBody('{}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ got: {} });
  });
});
