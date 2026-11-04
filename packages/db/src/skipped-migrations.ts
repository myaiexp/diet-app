// Finds journal migrations a database will never apply (below the `when` gate)
//
// drizzle's migrator applies every journal entry whose `when` exceeds the single
// greatest `created_at` in drizzle.__drizzle_migrations, and never compares hashes. A
// worktree may apply additive DDL to the one shared database (migrate-guard.ts), so a
// branch whose migration was generated LATER can be applied before one generated
// earlier lands. The earlier one then sits below the gate forever: `migrate` reports
// success and the code that needs its schema fails at runtime. This makes that loud.

import type { AppliedMigration, JournalMigration } from './journal-drift.js';

/**
 * Entries whose hash no row records and whose `when` is at or below the newest applied
 * `created_at`. A row the journal does not name still raises the gate — it is another
 * branch's migration, and drizzle compares against it all the same.
 */
export function findSkippedMigrations(
  journal: JournalMigration[],
  applied: AppliedMigration[],
): JournalMigration[] {
  if (applied.length === 0) return [];
  const newest = newestApplied(applied);
  const recorded = new Set(applied.map((row) => row.hash));
  return journal.filter((m) => !recorded.has(m.hash) && m.when <= newest);
}

/** The migrator's gate: the greatest recorded `created_at`. Call only with rows. */
export function newestApplied(applied: AppliedMigration[]): number {
  return applied.reduce((max, row) => Math.max(max, row.createdAt), -Infinity);
}

/** The refusal text: which migrations, why drizzle passes over them, and the fix. */
export function renderSkipped(skipped: JournalMigration[], newest: number): string {
  const lines = [
    '',
    '✖  migrations the database will never apply: each is unrecorded, but its journal',
    `   \`when\` is not later than the newest applied row (created_at ${newest}), and`,
    '   drizzle applies only entries above that line.',
    '',
    ...skipped.map((m) => `   drizzle/${m.tag}.sql   when ${m.when}`),
    '',
    '   What to do:',
    '     • Not yet landed (your branch)? Regenerate it so its `when` is the newest:',
    '       delete its .sql, its meta snapshot and its journal entry, rebase onto',
    '       master, then `pnpm --filter @diet-app/db generate` again.',
    '     • Already on master? Apply its SQL by hand, then record it:',
    "       INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<sha256 of",
    "       the .sql>', <its journal when>);",
    '',
  ];
  return lines.join('\n');
}
