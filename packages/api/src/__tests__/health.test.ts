// /api/health: 200 only when Postgres answers; one probe query per cache window
import { describe, test, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
import { createHealthProbe } from '../health.js';

function dbWith(execute: () => Promise<unknown>) {
  return { execute: vi.fn(execute) } as any;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('health endpoint', () => {
  test('200 with db ok when the probe query succeeds', async () => {
    const db = dbWith(async () => ({ rows: [{ '?column?': 1 }] }));
    const res = await createApp(db).request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: 'diet-app-api', db: 'ok' });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  test('503 with db unreachable when the probe query throws, and logs why', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = dbWith(async () => {
      throw new Error('password authentication failed for user "dietapp"');
    });
    const res = await createApp(db).request('/api/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, name: 'diet-app-api', db: 'unreachable' });
    expect(log.mock.calls.flat().join(' ')).toContain('password authentication failed');
  });

  test('stays public when auth is configured', async () => {
    const db = dbWith(async () => ({}));
    const res = await createApp(db, { authToken: 'tok' }).request('/api/health');
    expect(res.status).toBe(200);
  });
});

describe('createHealthProbe', () => {
  test('a probe that never settles fails at the timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const probe = createHealthProbe(dbWith(() => new Promise(() => {})), { timeoutMs: 1000 });
    const result = probe();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe(false);
  });

  test('concurrent callers share one in-flight query', async () => {
    let release!: () => void;
    const db = dbWith(() => new Promise<void>((r) => (release = r)));
    const probe = createHealthProbe(db);
    const a = probe();
    const b = probe();
    release();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  test('a settled result is reused inside the cache window, re-probed after it', async () => {
    let now = 0;
    const db = dbWith(async () => ({}));
    const probe = createHealthProbe(db, { cacheMs: 2000, now: () => now });
    await probe();
    now = 1999;
    await probe();
    expect(db.execute).toHaveBeenCalledTimes(1);
    now = 2000;
    await probe();
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  test('a failure is cached too, so a flood against a dead DB stays one query per window', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let now = 0;
    const db = dbWith(async () => {
      throw new Error('ECONNREFUSED');
    });
    const probe = createHealthProbe(db, { cacheMs: 2000, now: () => now });
    expect(await probe()).toBe(false);
    now = 500;
    expect(await probe()).toBe(false);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
