// May this `pnpm migrate` run? Pure — no I/O, no DB, no git, no clock.
//
// diet-app has no dev database. `drizzle-kit migrate` from a worktree writes
// PRODUCTION's schema while prod still runs whatever is on master — so a DROP applied
// here breaks the deployed API and stays broken until that branch deploys. helm took
// exactly that outage on 2026-08-22: 25 minutes of HTTP 500 after four columns went
// from a worktree.
//
// The fix is not a new pipeline: the push-to-deploy hook ALREADY runs drizzle-kit
// migrate from ~/Projects/diet-app/packages/db, immediately after landing the branch
// (helm's scripts/forgejo-deploy, the diet-app case). So the destructive half simply
// belongs there, and this guard's whole job is to send it there. Additive DDL still
// applies straight from a worktree, because that is what a session developing against a
// new column needs. Ported from helm's src/db/migrate-guard.ts.
import type { DestructiveStatement } from './destructive-ddl.js';

/** A migration drizzle-kit is about to apply, with whatever the scan found in it. */
export interface PendingMigration {
  /** Journal tag, e.g. '0001_gigantic_wild_pack'. */
  tag: string;
  findings: DestructiveStatement[];
}

export interface MigrateGuardInput {
  /**
   * Is the CWD the repo's MAIN checkout (the tree systemd runs and deploy lands into)?
   *
   * `null` means git could not answer, which counts as "not the main checkout": the
   * escape is one flag, while guessing the other way reproduces the incident. Note a
   * git this broken breaks `deploy` too, so --force is the path either way.
   */
  mainCheckout: boolean | null;
  pending: PendingMigration[];
  /** `--force` — the operator asserts prod's running code no longer needs the surface. */
  force: boolean;
}

export type MigrateGuardVerdict =
  | { action: 'run' }
  | { action: 'refuse'; offenders: PendingMigration[] };

/**
 * Refuse only when all three hold: destructive DDL, pending (so drizzle really would
 * apply it), and a tree that is not the one prod runs. Anything else runs.
 */
export function decideMigrate({ mainCheckout, pending, force }: MigrateGuardInput): MigrateGuardVerdict {
  if (force || mainCheckout === true) return { action: 'run' };
  const offenders = pending.filter((m) => m.findings.length > 0);
  return offenders.length > 0 ? { action: 'refuse', offenders } : { action: 'run' };
}

/**
 * The refusal text. It names every offending statement, because the first question is
 * always "which line?" — and then the resolution, which is usually to do nothing at all
 * and let deploy apply it.
 */
export function renderRefusal(offenders: PendingMigration[], opts: { mainCheckout: boolean | null }): string {
  const lines: string[] = [];
  const where =
    opts.mainCheckout === null
      ? 'git could not say whether this is the main checkout'
      : 'this is a worktree, not the main checkout';

  lines.push('');
  lines.push(`✖  migrate refused: pending migrations contain destructive DDL and ${where}.`);
  lines.push('');
  lines.push('   diet-app has ONE database (dietapp) and helm copies the .env naming it into');
  lines.push('   every worktree, so migrating from here rewrites PRODUCTION\'s schema while prod');
  lines.push('   still runs the code on master — the dropped surface goes out from under it and');
  lines.push('   stays that way until this branch deploys. (helm took exactly this outage on');
  lines.push('   2026-08-22: four columns, 25 minutes of HTTP 500.)');
  lines.push('');

  for (const m of offenders) {
    lines.push(`   drizzle/${m.tag}.sql`);
    for (const f of m.findings) {
      lines.push(`     L${String(f.line).padEnd(4)} ${f.kind.padEnd(18)} ${f.statement}`);
    }
    lines.push('');
  }

  lines.push('   What to do:');
  lines.push('     • Nothing. Commit the .sql alongside the code and run `deploy` — the');
  lines.push('       push-to-deploy hook runs drizzle-kit migrate from ~/Projects/diet-app right');
  lines.push('       after landing your branch, so the drop lands with the code that stopped');
  lines.push('       using the surface.');
  lines.push('     • Need the schema NOW to develop against? Split expand from contract: the');
  lines.push('       additive migration applies from a worktree today, the destructive one ships');
  lines.push('       with the code.');
  lines.push('     • Already deployed, or catching up a migration the deploy failed to apply?');
  lines.push('       pnpm --filter @diet-app/db migrate --force');
  lines.push('');

  return lines.join('\n');
}
