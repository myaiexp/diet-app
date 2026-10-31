// CLI behind setup-test-db.sh: repair journal drift in a *_test database, then migrate.
//
// The repair is safe here and only here: a test database is disposable, and prod's
// migration history is not something a script should rewrite without a person looking.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, describeMigrationError, openMigrationDb } from '../src/apply-migrations.js';
import {
  findJournalDrift,
  readApplied,
  readJournal,
  renderDrift,
  repairJournalDrift,
} from '../src/journal-drift.js';
import { assertTestDbUrl } from '../src/test-db-url.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  assertTestDbUrl(url);

  const db = openMigrationDb(url);
  try {
    const drifted = findJournalDrift(readJournal(MIGRATIONS), await readApplied(db.$client));
    if (drifted.length > 0) {
      console.log(`Repairing ${drifted.length} drifted migration record(s):\n${renderDrift(drifted)}`);
      await repairJournalDrift(db.$client, drifted);
    }
    await applyMigrations(db, MIGRATIONS);
    console.log('Migrations applied');
  } finally {
    await db.$client.end();
  }
}

main().catch((err: unknown) => {
  console.error(`✖  migrate failed: ${describeMigrationError(err)}`);
  process.exit(1);
});
