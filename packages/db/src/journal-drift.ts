// Detect and repair an applied migration whose recorded time no longer matches the journal
//
// drizzle's migrator applies every journal entry whose `when` exceeds the single
// greatest `created_at` in drizzle.__drizzle_migrations; it never compares hashes. So
// when a migration is regenerated after a database applied it (same SQL, new `when`),
// the migrator re-runs it and fails on objects that already exist. A row whose hash
// matches a journal entry proves that SQL ran, so its `created_at` can be corrected.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { FRESH_DATABASE_CODES } from './migrate-guard-io.js';

export interface JournalMigration {
  tag: string;
  when: number;
  /** sha256 of the .sql file: drizzle's own value, what the migrations table stores. */
  hash: string;
}

export interface AppliedMigration {
  hash: string;
  createdAt: number;
}

export interface DriftedMigration {
  tag: string;
  hash: string;
  recorded: number;
  when: number;
}

/** The slice of a pg Pool or Client these reads use. */
export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export function readJournal(migrationsFolder: string): JournalMigration[] {
  const { entries } = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string; when: number }[] };
  // readMigrationFiles walks the same entries in the same order.
  const files = readMigrationFiles({ migrationsFolder });
  return entries.map((entry, i) => ({ tag: entry.tag, when: entry.when, hash: files[i]!.hash }));
}

/** Empty on a database that has never been migrated. */
export async function readApplied(client: QueryClient): Promise<AppliedMigration[]> {
  try {
    const { rows } = await client.query(
      'select hash, created_at from drizzle.__drizzle_migrations',
    );
    return (rows as { hash: string; created_at: string }[]).map((row) => ({
      hash: row.hash,
      createdAt: Number(row.created_at),
    }));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== undefined && FRESH_DATABASE_CODES.has(code)) return [];
    throw err;
  }
}

/**
 * A row the journal does not name is left out: every worktree shares dietapp_test,
 * so it is another branch's migration, not drift in this checkout.
 */
export function findJournalDrift(
  journal: JournalMigration[],
  applied: AppliedMigration[],
): DriftedMigration[] {
  const recordedByHash = new Map(applied.map((row) => [row.hash, row.createdAt]));
  return journal.flatMap((migration) => {
    const recorded = recordedByHash.get(migration.hash);
    if (recorded === undefined || recorded === migration.when) return [];
    return [{ tag: migration.tag, hash: migration.hash, recorded, when: migration.when }];
  });
}

export async function repairJournalDrift(
  client: QueryClient,
  drifted: DriftedMigration[],
): Promise<void> {
  for (const migration of drifted) {
    await client.query('update drizzle.__drizzle_migrations set created_at = $1 where hash = $2', [
      migration.when,
      migration.hash,
    ]);
  }
}

export function renderDrift(drifted: DriftedMigration[]): string {
  return drifted
    .map((m) => `${m.tag}: recorded created_at ${m.recorded}, journal when ${m.when}`)
    .join('\n');
}
