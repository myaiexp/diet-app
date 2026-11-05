// Health probe: does Postgres answer? Bounded, single-flight, briefly cached
import { sql } from 'drizzle-orm';
import type { Db } from '@diet-app/db';
import { describeError } from './describe-error.js';

export interface HealthProbeOptions {
  // Below the pool's 5s connectionTimeoutMillis: a health check that takes as
  // long as a real request to fail tells a monitor nothing sooner.
  timeoutMs?: number;
  // /api/health is unauthenticated, so anyone who reaches it can poll it. The
  // cache keeps that to one query per window, healthy or not — a flood against
  // a dead DB must not queue a connect attempt per request.
  cacheMs?: number;
  now?: () => number;
}

export function createHealthProbe(db: Db, opts: HealthProbeOptions = {}): () => Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const cacheMs = opts.cacheMs ?? 2_000;
  const now = opts.now ?? Date.now;

  let inFlight: Promise<boolean> | null = null;
  let cached: { ok: boolean; at: number } | null = null;

  async function run(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      await Promise.race([db.execute(sql`select 1`), timeout]);
      return true;
    } catch (err) {
      console.error(`[health] database probe failed: ${describeError(err)}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return () => {
    if (cached && now() - cached.at < cacheMs) return Promise.resolve(cached.ok);
    if (!inFlight) {
      inFlight = run().then((ok) => {
        cached = { ok, at: now() };
        inFlight = null;
        return ok;
      });
    }
    return inFlight;
  };
}
