// Sibling-origin CSRF gates on mutating /api/ methods (finding #7991)
import { describe, test, expect } from 'vitest';
import { createApp } from '../app.js';
import { makeSelectMock } from './db-mock.js';

const TOKEN = 'super-secret-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const SIBLING = 'https://prospect.mase.fi';
const JSON_CT = { 'Content-Type': 'application/json' };
const MEAL_PLAN_BODY = JSON.stringify({
  date: '2026-08-24',
  slot: 'dinner',
  freeformNote: 'csrf',
  servings: 1,
});

function app(corsOrigins?: string[]) {
  return createApp({} as any, {
    authToken: TOKEN,
    ...(corsOrigins ? { corsOrigins } : {}),
  });
}

describe('mutating CSRF guard', () => {
  test('rejects a text/plain POST (CORS-simple JSON body) with 415', async () => {
    const res = await app().request('/api/meal-plans', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'text/plain' },
      body: MEAL_PLAN_BODY,
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' });
  });

  test('rejects a form POST with 415', async () => {
    const res = await app().request('/api/meal-plans', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'freeformNote=csrf',
    });
    expect(res.status).toBe(415);
  });

  test('rejects an empty POST /cook with no Content-Type (CORS-simple)', async () => {
    const res = await app().request('/api/meal-plans/00000000-0000-4000-8000-000000000001/cook', {
      method: 'POST',
      headers: AUTH,
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' });
  });

  test('rejects a sibling Origin with Sec-Fetch-Site: same-site', async () => {
    const res = await app().request('/api/meal-plans', {
      method: 'POST',
      headers: {
        ...AUTH,
        ...JSON_CT,
        Origin: SIBLING,
        'Sec-Fetch-Site': 'same-site',
      },
      body: MEAL_PLAN_BODY,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  test('rejects Sec-Fetch-Site: cross-site when Origin is not CORS-allowlisted', async () => {
    const res = await app().request('/api/recipes/import', {
      method: 'POST',
      headers: {
        ...AUTH,
        ...JSON_CT,
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: JSON.stringify({ url: 'https://evil.example/recipe' }),
    });
    expect(res.status).toBe(403);
  });

  test('accepts application/json with a charset parameter (reaches auth)', async () => {
    const res = await app().request('/api/meal-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: MEAL_PLAN_BODY,
    });
    expect(res.status).toBe(401);
  });

  test('allows a JSON POST with no Sec-Fetch-Site (curl/cron reaches auth)', async () => {
    const res = await app().request('/api/meal-plans', {
      method: 'POST',
      headers: JSON_CT,
      body: MEAL_PLAN_BODY,
    });
    expect(res.status).toBe(401);
  });

  test('allows Sec-Fetch-Site: same-origin (reaches auth)', async () => {
    const res = await app().request('/api/meal-plans', {
      method: 'POST',
      headers: { ...JSON_CT, 'Sec-Fetch-Site': 'same-origin' },
      body: MEAL_PLAN_BODY,
    });
    expect(res.status).toBe(401);
  });

  test('allows a CORS-allowlisted Origin even when Sec-Fetch-Site is cross-site', async () => {
    const extra = 'https://other.example';
    const res = await app([extra]).request('/api/meal-plans', {
      method: 'POST',
      headers: {
        ...JSON_CT,
        Origin: extra,
        'Sec-Fetch-Site': 'cross-site',
      },
      body: MEAL_PLAN_BODY,
    });
    expect(res.status).toBe(401);
  });

  test('GET is not gated — cross-site fetch-site still reaches the route', async () => {
    const { db } = makeSelectMock([]);
    const wired = createApp(db, { authToken: TOKEN });
    const res = await wired.request('/api/ingredients', {
      headers: { ...AUTH, 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(200);
  });

  test('DELETE from a sibling is 403 even without a body', async () => {
    const res = await app().request('/api/pantry/00000000-0000-4000-8000-000000000001', {
      method: 'DELETE',
      headers: { ...AUTH, Origin: SIBLING, 'Sec-Fetch-Site': 'same-site' },
    });
    expect(res.status).toBe(403);
  });

  test('DELETE without Sec-Fetch-Site still reaches auth', async () => {
    const res = await app().request('/api/pantry/00000000-0000-4000-8000-000000000001', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});
