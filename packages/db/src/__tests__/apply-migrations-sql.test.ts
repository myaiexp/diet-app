// Real-Postgres test: a re-run migration fails with its error, and repairing drift clears it.
//
// Runs in a throwaway database with a throwaway migrations folder, because the
// migrator's bookkeeping table is what is under test and dietapp_test's copy is
// shared by every worktree.

import { describe, test, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { assertTestDbUrl, resolveDbName, testDatabaseUrl } from '../test-db-url.js';
import type { Db } from '../connection.js';
import { applyMigrations, describeMigrationError, openMigrationDb } from '../apply-migrations.js';
import {
  findJournalDrift,
  readApplied,
  readJournal,
  repairJournalDrift,
} from '../journal-drift.js';

config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });

const TEST_DB_URL = testDatabaseUrl();

// SAFETY: same guard as the api suite — the database name must end in `_test`.
if (TEST_DB_URL) assertTestDbUrl(TEST_DB_URL);

const hasDb = Boolean(TEST_DB_URL);
const scratchName = `dietapp_migrate_${randomUUID().replaceAll('-', '')}_test`;
const folder = mkdtempSync(join(tmpdir(), 'diet-migrate-'));
const migrationSql = {
  '0000_first': 'CREATE TABLE drift_probe_first (id integer);',
  '0001_second': 'CREATE TABLE drift_probe_second (id integer);',
};

function writeMigrations(): void {
  mkdirSync(join(folder, 'meta'));
  const entries = Object.keys(migrationSql).map((tag, idx) => ({
    idx,
    version: '7',
    when: 1_000 + idx,
    tag,
    breakpoints: true,
  }));
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  );
  for (const [tag, sql] of Object.entries(migrationSql)) writeFileSync(join(folder, `${tag}.sql`), sql);
}

async function onMaintenanceDb(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

let db: Db;

beforeAll(async () => {
  writeMigrations();
  if (!hasDb) return;
  await onMaintenanceDb(`CREATE DATABASE ${scratchName}`);
  db = openMigrationDb(TEST_DB_URL!.replace(`/${resolveDbName(TEST_DB_URL!)}`, `/${scratchName}`));
});

afterAll(async () => {
  rmSync(folder, { recursive: true, force: true });
  if (!hasDb) return;
  await db.$client.end();
  await onMaintenanceDb(`DROP DATABASE IF EXISTS ${scratchName}`);
});

// A scoped `vitest run` never reaches the other files' gates, so this file has its own.
describe('integration DB gate', () => {
  test.skipIf(process.env.DIET_APP_SKIP_DB_TESTS === '1')('TEST_DATABASE_URL is configured', () => {
    expect(hasDb, 'TEST_DATABASE_URL (or DATABASE_URL_TEST) is not set; see docs/testing.md').toBe(true);
  });
});

describe.skipIf(!hasDb).sequential('applyMigrations', () => {
  test('a database never migrated reads as nothing applied, then applies cleanly', async () => {
    expect(await readApplied(db.$client)).toEqual([]);

    await applyMigrations(db, folder);

    const journal = readJournal(folder);
    expect(journal.map((m) => m.tag)).toEqual(['0000_first', '0001_second']);
    expect(findJournalDrift(journal, await readApplied(db.$client))).toEqual([]);
  });

  test('drift makes the migrator re-run a migration, and the Postgres error survives', async () => {
    await db.$client.query('update drizzle.__drizzle_migrations set created_at = created_at - 500');

    const error = await applyMigrations(db, folder).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).not.toBeNull();
    expect(describeMigrationError(error)).toContain('already exists');
  });

  test('repair restores the journal times, so the next run is a no-op', async () => {
    const journal = readJournal(folder);
    const drifted = findJournalDrift(journal, await readApplied(db.$client));
    expect(drifted.map((m) => m.tag)).toEqual(['0000_first', '0001_second']);

    await repairJournalDrift(db.$client, drifted);

    const applied = await readApplied(db.$client);
    expect(findJournalDrift(journal, applied)).toEqual([]);
    await applyMigrations(db, folder);
    expect(await readApplied(db.$client)).toHaveLength(2);
  });
});

describe('readJournal', () => {
  test("reads this repo's own migrations in journal order", () => {
    const real = fileURLToPath(new URL('../../drizzle', import.meta.url));
    const tags = readJournal(real).map((m) => m.tag);
    expect(tags[0]).toMatch(/^0000_/);
    expect(tags).toEqual([...tags].sort());
  });
});
