import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import { createApp } from '../app.js';

// Mock db — health endpoint doesn't use it
const mockDb = {} as any;

describe('health endpoint', () => {
  const app = createApp(mockDb);

  test('GET /api/health returns ok', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.name).toBe('diet-app-api');
  });
});
