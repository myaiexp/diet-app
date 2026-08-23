// Wire-level bodyLimit: oversized POST is 413 before auth or JSON parse

import { describe, test, expect } from 'vitest';
import { createApp, MAX_BODY_BYTES } from '../app.js';

const TOKEN = 'super-secret-token';

describe('createApp bodyLimit', () => {
  test('rejects a body over the cap with 413 before auth runs', async () => {
    const app = createApp({} as any, { authToken: TOKEN });
    const over = MAX_BODY_BYTES + 1;
    const res = await app.request('/api/ingredients', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': String(over),
      },
      body: 'x'.repeat(over),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Request body too large' });
  });

  test('a body exactly at the cap still reaches auth (401, not 413)', async () => {
    const app = createApp({} as any, { authToken: TOKEN });
    const res = await app.request('/api/ingredients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_BODY_BYTES),
      },
      body: 'x'.repeat(MAX_BODY_BYTES),
    });
    expect(res.status).toBe(401);
  });

  test('a small body still reaches auth (401, not a blanket 413)', async () => {
    const app = createApp({} as any, { authToken: TOKEN });
    const res = await app.request('/api/ingredients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  test('GET /api/health is unaffected', async () => {
    const app = createApp({} as any, { authToken: TOKEN });
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });
});
