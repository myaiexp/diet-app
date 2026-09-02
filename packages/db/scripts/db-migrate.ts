// CLI shim behind `pnpm --filter @diet-app/db migrate` — guard, then drizzle-kit migrate.
//
// All the policy is in src/migrate-guard.ts + src/destructive-ddl.ts; this file is the
// I/O half: which tree am I in (git), what is still pending (the migrations table), and
// handing off to the real binary. The push-to-deploy hook deliberately calls drizzle-kit
// directly instead of coming through here — it migrates from the main checkout moments
// after landing the branch, which is the exact case this guard exists to route work TO,
// and a node shim in that path could only ever wedge a deploy.
//
// Usage: pnpm --filter @diet-app/db migrate [--force] [drizzle-kit args…]

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import drizzleConfig from '../drizzle.config.js';
import { findDestructiveDdl } from '../src/destructive-ddl.js';
import { decideMigrate, renderRefusal, type PendingMigration } from '../src/migrate-guard.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * git vars that OUTRANK `cwd`/`-C` entirely. Anything running under a git hook passes
 * them down, so a `git` call that inherited GIT_DIR would confidently answer about a
 * DIFFERENT repo — and a worktree's destructive migration would read as the main
 * checkout's. Stripping them makes cwd authoritative again.
 */
function gitSafeEnv(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_COMMON_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_NAMESPACE',
    'GIT_PREFIX',
  ]) {
    delete clean[key];
  }
  return clean;
}

/**
 * Is this the repo's main checkout (~/Projects/diet-app, the tree systemd runs and
 * deploy lands into)? In a linked worktree git-dir points into `.git/worktrees/<name>`
 * while git-common-dir stays at the main `.git`; in the main checkout they are the same
 * path. `null` when git cannot answer at all.
 */
function isMainCheckout(): boolean | null {
  try {
    const ask = (flag: string): string =>
      execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--path-format=absolute', flag], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: gitSafeEnv(),
      }).trim();
    return realpathSync(ask('--git-dir')) === realpathSync(ask('--git-common-dir'));
  } catch {
    return null;
  }
}

/**
 * The journal's `when` of the newest APPLIED migration, or null on a database that has
 * never been migrated. This is drizzle's own gate, not an approximation of it: its
 * migrator applies every journal entry whose `when` exceeds the single greatest
 * `created_at` in the table (drizzle-orm/pg-core/dialect.js).
 */
async function lastAppliedWhen(url: string): Promise<number | null> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<{ created_at: string }>(
      'select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1',
    );
    const row = res.rows[0];
    return row ? Number(row.created_at) : null;
  } catch (err) {
    // No migrations table yet (missing relation or missing schema) — a fresh database,
    // where every journal entry is pending. Any other error is a real problem and must
    // not be spent as "nothing applied", which would flag the whole history.
    const code = (err as { code?: string }).code;
    if (code === '42P01' || code === '3F000') return null;
    throw err;
  } finally {
    await client.end();
  }
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
    applied = await lastAppliedWhen(url);
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

  const mainCheckout = isMainCheckout();
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
