// Unhandled route errors: JSON 500 envelope plus a log line naming the request
import { describe, test, expect, vi, afterEach } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { createApp } from '../app.js';

afterEach(() => vi.restoreAllMocks());

function throwingDb(err: unknown) {
  return {
    select: () => {
      throw err;
    },
  } as any;
}

describe('createApp onError', () => {
  test('a thrown error is a JSON 500, and the log names method, path and cause', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = Object.assign(new Error('connection terminated'), { code: '57P01' });
    const app = createApp(throwingDb(new Error('Failed query', { cause })));

    const res = await app.request('/api/ingredients?limit=5');

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
    const logged = log.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('GET /api/ingredients');
    expect(logged).toContain('connection terminated');
  });

  test('the response never carries the error text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(throwingDb(new Error('password=hunter2 leaked')));
    const res = await app.request('/api/ingredients');
    expect(await res.text()).not.toContain('hunter2');
  });

  test('an HTTPException keeps its status, in the JSON envelope, without a 500 log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(throwingDb(new HTTPException(418, { message: 'teapot' })));
    const res = await app.request('/api/ingredients');
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: 'teapot' });
    expect(log).not.toHaveBeenCalled();
  });

  test('an HTTPException carrying its own response is returned as-is', async () => {
    const own = new Response('custom', { status: 409 });
    const app = createApp(throwingDb(new HTTPException(409, { res: own })));
    const res = await app.request('/api/ingredients');
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('custom');
  });
});
