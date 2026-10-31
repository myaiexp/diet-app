// CLI shim behind `pnpm --filter @diet-app/db migrate` — guard, then apply the migrations.
//
// All the policy is in src/migrate-guard.ts + src/destructive-ddl.ts, and the git/pg
// reads are in src/migrate-guard-io.ts; this file wires them to the journal on disk and
// applies through drizzle-orm's migrator, not the drizzle-kit binary, so a failed statement
// prints its Postgres error instead of exiting 1 silently (src/apply-migrations.ts). Journal
// drift is reported, never repaired here: this command can point at production, whose
// migration history needs a person looking. The push-to-deploy hook deliberately calls drizzle-kit
// directly instead of coming through here — it migrates from the main checkout moments
// after landing the branch, which is the exact case this guard exists to route work TO,
// and a node shim in that path could only ever wedge a deploy.
//
// Usage: pnpm --filter @diet-app/db migrate [--force]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import drizzleConfig from '../drizzle.config.js';
import { decideMigrate, pendingMigrations, renderRefusal } from '../src/migrate-guard.js';
import { isMainCheckout, lastAppliedWhen } from '../src/migrate-guard-io.js';
import { applyMigrations, describeMigrationError, openMigrationDb } from '../src/apply-migrations.js';
import { findJournalDrift, readApplied, readJournal, renderDrift } from '../src/journal-drift.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const unknown = argv.filter((a) => a !== '--force');
  if (unknown.length > 0) {
    console.error(`✖  unknown argument: ${unknown.join(' ')}. Usage: migrate [--force]`);
    process.exit(1);
  }

  // The DSN `generate` and the deploy's drizzle-kit use — imported rather than re-derived,
  // so the guard can never inspect a different database than the one about to be migrated.
  const url = (drizzleConfig as { dbCredentials?: { url?: string } }).dbCredentials?.url;
  if (!url) {
    console.error(
      '✖  drizzle.config.ts exposes no dbCredentials.url — cannot check pending migrations.',
    );
    process.exit(1);
  }

  const journal = JSON.parse(
    readFileSync(join(PKG_ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };

  let applied: number | null;
  try {
    applied = await lastAppliedWhen(new pg.Client({ connectionString: url }));
  } catch (err) {
    console.error(`✖  Could not read drizzle.__drizzle_migrations: ${(err as Error).message}`);
    console.error(
      '   The migrator would fail on the same connection. Fix it, or bypass with --force.',
    );
    process.exit(1);
  }

  const pending = pendingMigrations(journal.entries, applied, (tag) =>
    readFileSync(join(PKG_ROOT, 'drizzle', `${tag}.sql`), 'utf8'),
  );

  const mainCheckout = isMainCheckout(REPO_ROOT);
  const verdict = decideMigrate({ mainCheckout, pending, force });
  if (verdict.action === 'refuse') {
    console.error(renderRefusal(verdict.offenders, { mainCheckout }));
    process.exit(1);
  }

  const migrationsFolder = join(PKG_ROOT, 'drizzle');
  const db = openMigrationDb(url);
  try {
    await applyMigrations(db, migrationsFolder);
    console.log('✓ migrations applied');
  } catch (err) {
    console.error(`✖  migrate failed: ${describeMigrationError(err)}`);
    const drifted = findJournalDrift(readJournal(migrationsFolder), await readApplied(db.$client));
    if (drifted.length > 0) {
      console.error(
        `\n   Likely cause — recorded times differ from the journal, so the migrator re-ran\n` +
          `   SQL this database already has:\n${renderDrift(drifted)}\n` +
          '   Fix: UPDATE drizzle.__drizzle_migrations SET created_at = <journal when> WHERE hash = <row hash>.',
      );
    }
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(`✖  migrate failed: ${(err as Error).message}`);
  process.exit(1);
});
