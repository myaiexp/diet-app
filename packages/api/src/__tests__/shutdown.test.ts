// Graceful shutdown: drain in-flight requests, end the pool, exit; bounded by a deadline
import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { createShutdown, closeHttpServer } from '../shutdown.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function deps(over: Partial<Parameters<typeof createShutdown>[0]> = {}) {
  const order: string[] = [];
  const d = {
    closeServer: vi.fn(async () => {
      order.push('server');
    }),
    forceCloseConnections: vi.fn(() => {
      order.push('force');
    }),
    closeDb: vi.fn(async () => {
      order.push('db');
    }),
    exit: vi.fn((code: number) => {
      order.push(`exit ${code}`);
    }),
    log: vi.fn(),
    drainMs: 1000,
    ...over,
  };
  return { d, order };
}

describe('createShutdown', () => {
  test('drains the server, then ends the pool, then exits 0', async () => {
    const { d, order } = deps();
    await createShutdown(d)('SIGTERM');
    expect(order).toEqual(['server', 'db', 'exit 0']);
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')).toContain('SIGTERM');
  });

  test('a drain past the deadline cuts the connections, still ends the pool, exits 1', async () => {
    vi.useFakeTimers();
    const { d, order } = deps({ closeServer: vi.fn(() => new Promise<void>(() => {})) });
    const done = createShutdown(d)('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(order).toEqual(['force', 'db', 'exit 1']);
  });

  test('a pool that will not end does not hold the exit past its own bound', async () => {
    vi.useFakeTimers();
    const { d, order } = deps({ closeDb: vi.fn(() => new Promise<void>(() => {})), poolEndMs: 500 });
    const done = createShutdown(d)('SIGTERM');
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(d.closeDb).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['server', 'exit 1']);
  });

  test('a second signal while draining exits 1 at once', async () => {
    const { d } = deps({ closeServer: vi.fn(() => new Promise<void>(() => {})) });
    const shutdown = createShutdown(d);
    void shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(d.exit).toHaveBeenCalledWith(1);
    expect(d.closeDb).not.toHaveBeenCalled();
  });
});

describe('closeHttpServer against a real server', () => {
  test('waits for an in-flight request to finish, and refuses new connections', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const app = new Hono();
    app.get('/slow', async (c) => {
      await gate;
      return c.json({ done: true });
    });
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const inFlight = fetch(`${base}/slow`);
    await new Promise((r) => setTimeout(r, 50)); // request reaches the handler
    let closed = false;
    const closing = closeHttpServer(server).then(() => (closed = true));

    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(false);
    await expect(fetch(`${base}/slow`)).rejects.toThrow();

    release();
    const res = await inFlight;
    expect(await res.json()).toEqual({ done: true });
    await closing;
    expect(closed).toBe(true);
  });
});
