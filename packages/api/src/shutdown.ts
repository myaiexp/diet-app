// SIGTERM/SIGINT: stop accepting, drain in-flight requests, end the pool, exit
import type { Server } from 'node:http';
import type { ServerType } from '@hono/node-server';

/**
 * The longest a client still waits for an answer: the web's IMPORT_TIMEOUT_MS
 * (45s, packages/web/src/api/recipe-import.ts). A request older than that has
 * no one left to read its response, so draining past it buys nothing. Stays
 * under systemd's default TimeoutStopSec (90s), after which it SIGKILLs.
 */
export const DRAIN_MS = 45_000;

/**
 * After the drain every request has finished, so no client is checked out and
 * `pool.end()` only closes idle sockets. A bound still, so a wedged socket
 * cannot hold the exit.
 */
export const POOL_END_MS = 5_000;

export interface ShutdownDeps {
  /** Stop accepting and resolve once every open connection has ended. */
  closeServer: () => Promise<void>;
  /** Cut whatever is still open when the drain deadline passes. */
  forceCloseConnections: () => void;
  closeDb: () => Promise<void>;
  exit: (code: number) => void;
  log?: (msg: string) => void;
  drainMs?: number;
  poolEndMs?: number;
}

type Outcome = 'ok' | 'failed' | 'timeout';

function bounded(work: () => Promise<void>, ms: number, onFail: (err: unknown) => void) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Outcome>((r) => (timer = setTimeout(() => r('timeout'), ms)));
  const run = work().then(
    (): Outcome => 'ok',
    (err): Outcome => {
      onFail(err);
      return 'failed';
    },
  );
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Returns the signal handler. Exit 0 only when both the drain and the pool end
 * finished cleanly; any timeout or error exits 1 so the journal shows the stop
 * was not clean. A second signal mid-drain (a second Ctrl-C) exits at once.
 */
export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const drainMs = deps.drainMs ?? DRAIN_MS;
  const poolEndMs = deps.poolEndMs ?? POOL_END_MS;
  let started = false;

  return async (signal) => {
    if (started) {
      log(`[shutdown] ${signal} again — exiting without waiting`);
      deps.exit(1);
      return;
    }
    started = true;
    log(`[shutdown] ${signal}: draining in-flight requests (up to ${drainMs}ms)`);

    const fail = (stage: string) => (err: unknown) =>
      console.error(`[shutdown] ${stage} failed:`, err);

    const drained = await bounded(deps.closeServer, drainMs, fail('server close'));
    if (drained === 'timeout') {
      log(`[shutdown] requests still open after ${drainMs}ms — closing their connections`);
      deps.forceCloseConnections();
    }
    const poolEnded = await bounded(deps.closeDb, poolEndMs, fail('pool end'));
    if (poolEnded === 'timeout') log(`[shutdown] pool did not end within ${poolEndMs}ms`);

    const clean = drained === 'ok' && poolEnded === 'ok';
    log(`[shutdown] ${clean ? 'clean' : 'unclean'} stop`);
    deps.exit(clean ? 0 : 1);
  };
}

/**
 * `server.close()` stops accepting and, on Node ≥19, drops idle keep-alive
 * sockets at once; it calls back when the last in-flight request has ended.
 */
export function closeHttpServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/** Wire the handler to SIGTERM (systemd stop) and SIGINT (Ctrl-C in dev). */
export function installShutdown(server: ServerType, closeDb: () => Promise<void>): void {
  const shutdown = createShutdown({
    closeServer: () => closeHttpServer(server),
    forceCloseConnections: () => (server as Server).closeAllConnections?.(),
    closeDb,
    exit: (code) => process.exit(code),
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}
