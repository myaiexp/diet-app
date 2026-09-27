// CLI shim behind `pnpm --filter @diet-app/db migrate` — guard, then drizzle-kit migrate.
//
// All the policy is in src/migrate-guard.ts + src/destructive-ddl.ts, and the git/pg
// reads are in src/migrate-guard-io.ts; this file wires them to the journal on disk and
// hands off to the real binary. The push-to-deploy hook deliberately calls drizzle-kit
// directly instead of coming through here — it migrates from the main checkout moments
// after landing the branch, which is the exact case this guard exists to route work TO,
// and a node shim in that path could only ever wedge a deploy.
//
// Usage: pnpm --filter @diet-app/db migrate [--force] [drizzle-kit args…]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import drizzleConfig from '../drizzle.config.js';
import { findDestructiveDdl } from '../src/destructive-ddl.js';
import { decideMigrate, renderRefusal, type PendingMigration } from '../src/migrate-guard.js';
import { isMainCheckout, lastAppliedWhen } from '../src/migrate-guard-io.js';

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
  const passthrough = argv.filter((a) => a !== '--force');

  // The same DSN drizzle-kit itself will use — imported rather than re-derived, so the
  // guard can never inspect a different database than the one about to be migrated.
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
      '   drizzle-kit would fail on the same connection. Fix it, or bypass with --force.',
    );
    process.exit(1);
    return;
  }

  const pending: PendingMigration[] = journal.entries
    .filter((e) => applied === null || e.when > applied)
    .map((e) => ({
      tag: e.tag,
      findings: findDestructiveDdl(
        readFileSync(join(PKG_ROOT, 'drizzle', `${e.tag}.sql`), 'utf8'),
      ),
    }));

  const mainCheckout = isMainCheckout(REPO_ROOT);
  const verdict = decideMigrate({ mainCheckout, pending, force });
  if (verdict.action === 'refuse') {
    console.error(renderRefusal(verdict.offenders, { mainCheckout }));
    process.exit(1);
  }

  // pnpm links a package's own devDependency into packages/db/node_modules/.bin; the
  // repo-root bin is the fallback for a hoisted install. Resolved rather than assumed,
  // because a missing binary here would read as "migrate silently did nothing".
  const bin = [
    join(PKG_ROOT, 'node_modules', '.bin', 'drizzle-kit'),
    join(REPO_ROOT, 'node_modules', '.bin', 'drizzle-kit'),
  ].find((p) => existsSync(p));
  if (!bin) {
    console.error('✖  drizzle-kit binary not found — run pnpm install.');
    process.exit(1);
  }

  const run = spawnSync(bin, ['migrate', ...passthrough], {
    cwd: PKG_ROOT,
    stdio: 'inherit',
  });
  process.exit(run.status ?? 1);
}

main().catch((err) => {
  console.error(`✖  migrate failed: ${(err as Error).message}`);
  process.exit(1);
});
