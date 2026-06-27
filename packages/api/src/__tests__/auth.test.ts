// Auth + CORS boundary tests (audit: no-auth + untested CORS findings).
// DB-free: the middleware rejects before any route runs, and the routes that do
// run use a chainable select mock — so no Postgres connection is ever opened.
import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import { bearerAuth } from '../auth.js';
import { createApp } from '../app.js';
import { makeSelectMock } from './select-mock.js';

const TOKEN = 'super-secret-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };

describe('bearerAuth middleware', () => {
  // Minimal app: middleware guards a single dummy route.
  const app = new Hono();
  app.use('*', bearerAuth(TOKEN));
  app.get('/x', (c) => c.json({ ok: true }));

  test('401 when the Authorization header is missing', async () => {
    const res = await app.request('/x');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  test('401 when the token is wrong', async () => {
    const res = await app.request('/x', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  test('401 when the scheme is not Bearer', async () => {
    const res = await app.request('/x', { headers: { Authorization: TOKEN } });
    expect(res.status).toBe(401);
  });

  test('passes through with the correct bearer token', async () => {
    const res = await app.request('/x', { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('createApp auth wiring', () => {
  test('health is public — no token required even when auth is configured', async () => {
    const app = createApp({} as any, { authToken: TOKEN });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('protected route returns 401 without a token (DB never touched)', async () => {
    // Empty db: a 401 from the middleware proves no route/db code ran.
    const app = createApp({} as any, { authToken: TOKEN });
    const res = await app.request('/api/ingredients');
    expect(res.status).toBe(401);
  });

  test('protected route is reachable with a valid token', async () => {
    const { db } = makeSelectMock([]);
    const app = createApp(db, { authToken: TOKEN });
    const res = await app.request('/api/ingredients', { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('auth is disabled when no token is configured (unit-test mode)', async () => {
    const { db } = makeSelectMock([]);
    const app = createApp(db); // no authToken
    const res = await app.request('/api/ingredients');
    expect(res.status).toBe(200);
  });
});

describe('CORS allowlist', () => {
  const acao = (res: Response) => res.headers.get('access-control-allow-origin');

  test('reflects an allowed origin', async () => {
    const app = createApp({} as any, { corsOrigins: ['https://mase.fi'] });
    const res = await app.request('/api/health', { headers: { Origin: 'https://mase.fi' } });
    expect(acao(res)).toBe('https://mase.fi');
  });

  test('omits the header for a disallowed origin', async () => {
    const app = createApp({} as any, { corsOrigins: ['https://mase.fi'] });
    const res = await app.request('/api/health', { headers: { Origin: 'http://evil.example' } });
    expect(acao(res)).toBeNull();
  });

  test('production config (mase.fi only) does NOT allow the dev localhost origin', async () => {
    const app = createApp({} as any, { corsOrigins: ['https://mase.fi'] });
    const res = await app.request('/api/health', { headers: { Origin: 'http://localhost:5173' } });
    expect(acao(res)).toBeNull();
  });
});
