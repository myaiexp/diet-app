// Pins the shared web test harness: jsonResponse, pathOf, and routeFetch.

import { describe, test, expect } from 'vitest';
import { jsonResponse, pathOf, routeFetch } from './harness.js';

describe('jsonResponse', () => {
  test('serializes a body with a JSON content-type', async () => {
    const res = jsonResponse(201, { id: 'a' });
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json');
    await expect(res.json()).resolves.toEqual({ id: 'a' });
  });

  test('an undefined body is empty, not the string "undefined"', async () => {
    const res = jsonResponse(200);
    expect(await res.text()).toBe('');
  });
});

describe('pathOf', () => {
  test('strips the query string from a relative URL', () => {
    expect(pathOf('/api/pantry?limit=50&offset=0')).toBe('/api/pantry');
  });

  test('accepts a Request', () => {
    expect(pathOf(new Request('http://x/api/recipes/r1'))).toBe('/api/recipes/r1');
  });
});

describe('routeFetch', () => {
  test('matches method + path and returns a fresh 200 JSON body', async () => {
    const fetchMock = routeFetch({ 'GET /api/pantry': [{ id: 'p1' }] });
    const res = await fetchMock('/api/pantry');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([{ id: 'p1' }]);
    const again = await fetchMock('/api/pantry');
    await expect(again.json()).resolves.toEqual([{ id: 'p1' }]);
  });

  test('captures :param segments and prefers a static segment over a param', async () => {
    const fetchMock = routeFetch({
      'GET /api/shopping-lists/:id': ({ params }) => ({ kind: 'id', id: params['id'] }),
      'GET /api/shopping-lists/current': { kind: 'current' },
    });
    await expect((await fetchMock('/api/shopping-lists/current')).json()).resolves.toEqual({
      kind: 'current',
    });
    await expect((await fetchMock('/api/shopping-lists/list-9')).json()).resolves.toEqual({
      kind: 'id',
      id: 'list-9',
    });
  });

  test('a method-bound route does not steal a different method on the same path', async () => {
    const fetchMock = routeFetch({
      'GET /api/recipes': [{ id: 'listed' }],
      'POST /api/recipes': ({ json }) => jsonResponse(201, { id: 'created', ...(json() as object) }),
    });
    await expect((await fetchMock('/api/recipes')).json()).resolves.toEqual([{ id: 'listed' }]);
    const posted = await fetchMock('/api/recipes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Soup' }),
    });
    expect(posted.status).toBe(201);
    await expect(posted.json()).resolves.toEqual({ id: 'created', title: 'Soup' });
  });

  test('a path-only key matches any method', async () => {
    const fetchMock = routeFetch({ '/api/ingredients': [{ id: 'ing-1' }] });
    await expect((await fetchMock('/api/ingredients', { method: 'GET' })).json()).resolves.toEqual([
      { id: 'ing-1' },
    ]);
    await expect((await fetchMock('/api/ingredients', { method: 'POST' })).json()).resolves.toEqual([
      { id: 'ing-1' },
    ]);
  });

  test('throws on an unmatched request by default, naming method and path', async () => {
    const fetchMock = routeFetch({ 'GET /api/pantry': [] });
    await expect(fetchMock('/api/recipes', { method: 'GET' })).rejects.toThrow(
      'unhandled request: GET /api/recipes',
    );
  });

  test('unmatched: 404 returns the conventional unhandled body', async () => {
    const fetchMock = routeFetch({ 'GET /api/pantry': [] }, { unmatched: '404' });
    const res = await fetchMock('/api/recipes');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'unhandled' });
  });

  test('a stored Response is cloned so the body can be read more than once', async () => {
    const fetchMock = routeFetch({ 'GET /api/ping': jsonResponse(200, { ok: true }) });
    await expect((await fetchMock('/api/ping')).json()).resolves.toEqual({ ok: true });
    await expect((await fetchMock('/api/ping')).json()).resolves.toEqual({ ok: true });
  });
});
