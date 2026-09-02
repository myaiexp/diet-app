// Cross-process advisory lock the real-Postgres suites hold while they run
//
// Test-only, but it lives in src (not __tests__) because both consumers reach
// it through the package index: vitest aliases @diet-app/db to src/index.ts and
// the built artifact resolves dist/index.js. __tests__ is excluded from the
// build, so an index that exported from there would not survive `pnpm build`.
//
// Why a lock at all: every worktree's .env points TEST_DATABASE_URL at the one
// dietapp_test database, so two sessions running the DB-backed files at once
// insert and delete each other's fixtures (idea #4088: five concurrent grind
// sessions produced 23502 not-null violations that vanished on a re-run alone).
// `test-suite` already serializes *full* runs per project, but the scoped
// `vitest run <path>` every implementer is told to use bypasses that — this
// covers both paths. The alternative, a database per worktree, would need
// create+migrate+seed provisioning in every fresh checkout for a case this
// fixes without any.

import pg from 'pg';

/**
 * The one key every DB-backed suite contends on. Any value works as long as
 * every caller agrees; it is a bigint in Postgres, so keep it a safe integer.
 */
export const DB_TEST_LOCK_KEY = 5_150_902_591;

export interface DbTestLock {
  /** Release the lock and close its connection. Safe to call more than once. */
  release(): Promise<void>;
}

export interface DbTestLockOptions {
  /** Contend on a different key — used by the lock's own tests. */
  key?: number;
  /** Give up (loudly) after this long. Default 120s. */
  timeoutMs?: number;
  /** How often to retry while another holder has it. Default 100ms. */
  pollMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Take the suite lock, waiting for any current holder.
 *
 * Polls `pg_try_advisory_lock` rather than blocking in `pg_advisory_lock` so
 * the wait has a deadline: a wedged holder should fail the run with a message
 * naming the cause, not hang it until CI kills the job. The lock rides its own
 * dedicated client — a pooled connection can be handed to another query, and a
 * session-scoped advisory lock would then be held by the wrong session. Postgres
 * drops it automatically if the process dies, so a crashed run leaves nothing
 * stale behind.
 */
export async function acquireDbTestLock(
  connectionString: string,
  opts: DbTestLockOptions = {},
): Promise<DbTestLock> {
  const key = opts.key ?? DB_TEST_LOCK_KEY;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollMs = opts.pollMs ?? 100;

  const client = new pg.Client({ connectionString });
  await client.connect();

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [key],
    );
    if (rows[0]?.locked) break;
    if (Date.now() >= deadline) {
      await client.end();
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the test-database lock (key ${key}). ` +
          'Another test run is using TEST_DATABASE_URL — wait for it, or run the ' +
          'DB-backed files once the other session is idle.',
      );
    }
    await sleep(pollMs);
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [key]);
      } finally {
        await client.end();
      }
    },
  };
}
