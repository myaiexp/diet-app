// Migration health against one database: chain problems, then skipped migrations
//
// Shared by `migrate` (refuses before applying) and `migrate:check` (post-deploy.sh runs
// it after the push-to-deploy hook's own drizzle-kit migrate, which this repo cannot
// guard). Both failures are invisible to drizzle: it reports success either way.

import { findChainProblems, readChain } from './migration-chain.js';
import { readApplied, readJournal, type QueryClient } from './journal-drift.js';
import { findSkippedMigrations, newestApplied, renderSkipped } from './skipped-migrations.js';

/** Refusal text, or null when the chain is consistent and nothing is skipped. */
export async function checkMigrations(
  migrationsFolder: string,
  client: QueryClient,
): Promise<string | null> {
  const problems = findChainProblems(readChain(migrationsFolder));
  if (problems.length > 0) {
    // A broken chain makes the hashes below meaningless (readJournal pairs journal
    // entries with .sql files by position), so stop here.
    return [
      '',
      '✖  drizzle/ is not one linear migration chain — usually a hand-resolved merge',
      '   conflict between two branches that each generated the same next migration:',
      ...problems.map((p) => `     ${p}`),
      '',
      '   Fix: keep master’s migrations as they are, delete this branch’s own (its .sql,',
      '   meta snapshot and journal entry), then `pnpm --filter @diet-app/db generate`.',
      '',
    ].join('\n');
  }

  const applied = await readApplied(client);
  const skipped = findSkippedMigrations(readJournal(migrationsFolder), applied);
  return skipped.length > 0 ? renderSkipped(skipped, newestApplied(applied)) : null;
}
