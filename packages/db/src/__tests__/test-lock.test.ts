// Real-Postgres tests for the cross-process lock the DB-backed suites serialize on

import { describe, test, expect } from 'vitest';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { acquireDbTestLock } from '../test-lock.js';
import { assertTestDbUrl } from '../test-db-url.js';

// Same .env read as the other two real-Postgres files: without it this one
// skips silently in a full run while their loud gates still pass.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
// Same prod guard as the suites that delete rows: this file opens a connection.
if (TEST_DB_URL) assertTestDbUrl(TEST_DB_URL);
const hasDb = Boolean(TEST_DB_URL);
const SKIP_DB_TESTS = process.env.DIET_APP_SKIP_DB_TESTS === '1';

// A key of this file's own, so contending here never queues behind (or delays)
// the real suites holding DB_TEST_LOCK_KEY.
const KEY = 5_150_902_777;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The scoped `vitest run test-lock` never reaches the other files' gates, so
// this one needs its own: an unset URL must fail here, not skip three cases.
describe('test-lock DB gate', () => {
  test.skipIf(SKIP_DB_TESTS)('TEST_DATABASE_URL is configured', () => {
    expect(
      hasDb,
      'TEST_DATABASE_URL is not set, so the advisory-lock tests would skip ' +
        'silently. Provision with `pnpm --filter @diet-app/db setup:test-db`. ' +
        'To run without Postgres on purpose, set DIET_APP_SKIP_DB_TESTS=1.',
    ).toBe(true);
  });
});

describe.skipIf(!hasDb)('acquireDbTestLock', () => {
  test('a second acquire waits until the first releases', async () => {
    const first = await acquireDbTestLock(TEST_DB_URL!, { key: KEY });
    let secondAcquired = false;
    const pending = acquireDbTestLock(TEST_DB_URL!, { key: KEY, pollMs: 10 }).then((lock) => {
      secondAcquired = true;
      return lock;
    });

    try {
      await sleep(80);
      expect(secondAcquired).toBe(false);

      await first.release();
      const second = await pending;
      expect(secondAcquired).toBe(true);
      await second.release();
    } finally {
      // Never leave a held lock behind for the next test file.
      await first.release().catch(() => {});
      await pending.then((l) => l.release()).catch(() => {});
    }
  });

  test('gives up loudly rather than hanging when the holder never releases', async () => {
    const held = await acquireDbTestLock(TEST_DB_URL!, { key: KEY });
    try {
      await expect(
        acquireDbTestLock(TEST_DB_URL!, { key: KEY, timeoutMs: 50, pollMs: 10 }),
      ).rejects.toThrow(/lock/i);
    } finally {
      await held.release();
    }
  });

  test('release is idempotent, so an afterAll can run twice without throwing', async () => {
    const lock = await acquireDbTestLock(TEST_DB_URL!, { key: KEY });
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();

    // …and the key really is free again.
    const again = await acquireDbTestLock(TEST_DB_URL!, { key: KEY, timeoutMs: 500, pollMs: 10 });
    await again.release();
  });
});
