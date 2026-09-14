// Shared setup for the real-Postgres route suites: prod guard, loud gate, lock
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
// Resolved from this file, not the CWD: a CWD-relative path silently loads
// nothing when vitest is invoked from the repo root instead of packages/api,
// which puts every real-Postgres suite back into silent-skip mode.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDb, acquireDbTestLock, type Db, type DbTestLock } from '@diet-app/db';

export interface RealDb {
  /** Null when TEST_DATABASE_URL is unset; every case then skips on `hasDb`. */
  db: Db | null;
  hasDb: boolean;
}

/**
 * Call once at the top level of a real-Postgres suite file (routes.test.ts,
 * rollback-*-sql.test.ts). Gated on TEST_DATABASE_URL: when it is absent the
 * suite's `describe.skipIf(!hasDb)` blocks skip rather than crashing at import,
 * so the mock suites in this dir still run Postgres-free.
 */
export function useRealDb(): RealDb {
  const url = process.env.TEST_DATABASE_URL;

  // SAFETY: never let a suite point at production. A URL that contains
  // 'dietapp' without the '_test' suffix hard-fails before any connection
  // opens. (The error omits the URL so embedded credentials don't leak.)
  if (url && url.includes('dietapp') && !url.includes('_test')) {
    throw new Error(
      "Refusing to run tests: TEST_DATABASE_URL looks like the production database " +
        "(contains 'dietapp' but not '_test'). Point it at dietapp_test before running tests.",
    );
  }

  const hasDb = Boolean(url);
  const db = hasDb ? createDb(url!) : null;

  // LOUD GATE: `describe.skipIf` alone reports quiet skips, which is how
  // routes.test.ts went 4 commits without ever executing. An unset
  // TEST_DATABASE_URL fails the run; opting out has to be deliberate:
  // DIET_APP_SKIP_DB_TESTS=1. The db package has the same gate over its
  // import-products-sql tests.
  const skipDbTests = process.env.DIET_APP_SKIP_DB_TESTS === '1';
  describe('integration DB gate', () => {
    test.skipIf(skipDbTests)('TEST_DATABASE_URL is configured', () => {
      expect(
        hasDb,
        'TEST_DATABASE_URL is not set, so the real-Postgres integration suites ' +
          'would skip silently. Provision the DB with ' +
          '`pnpm --filter @diet-app/db setup:test-db`, then add TEST_DATABASE_URL ' +
          'to the repo-root .env (see .env.example). To run the mock suites ' +
          'without Postgres on purpose, set DIET_APP_SKIP_DB_TESTS=1.',
      ).toBe(true);
    });
  });

  // Every worktree's .env aims TEST_DATABASE_URL at the same dietapp_test, so
  // two concurrent runs delete each other's fixtures mid-test (#4088). The
  // advisory lock is held for the whole file, and Postgres drops it if this
  // process dies.
  let lock: DbTestLock | null = null;
  beforeAll(async () => {
    if (hasDb) lock = await acquireDbTestLock(url!);
    // Above acquireDbTestLock's own 120s deadline, so a contended run reports
    // the lock's message rather than vitest's generic hook timeout.
  }, 130_000);

  afterAll(async () => {
    // Close the pool so the process exits cleanly, then hand the database to
    // whoever is queued behind us.
    await db?.$client.end();
    await lock?.release();
  });

  return { db, hasDb };
}
