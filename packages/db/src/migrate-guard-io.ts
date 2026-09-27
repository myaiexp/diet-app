// Migrate guard I/O: which checkout is this (git), newest applied migration (pg)
//
// Split out of scripts/db-migrate.ts so tests can import it — the script runs main() at
// top level. These two reads feed the pure verdict in migrate-guard.ts, and both fail
// in the direction that DISARMS it: a wrong `true` from isMainCheckout skips the
// destructive-DDL check entirely, and a swallowed error read as a high `applied` empties
// the pending list. Either way the guard reports success. Lives in src, not __tests__,
// so the build keeps it.

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

/**
 * git vars that OUTRANK `cwd`/`-C` entirely. Anything running under a git hook passes
 * them down, so a `git` call that inherited GIT_DIR would confidently answer about a
 * DIFFERENT repo — and a worktree's destructive migration would read as the main
 * checkout's. Stripping them makes cwd authoritative again.
 */
export const GIT_LOCATION_VARS = [
  'GIT_DIR',
  'GIT_COMMON_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
] as const;

export function gitSafeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of GIT_LOCATION_VARS) delete clean[key];
  return clean;
}

/**
 * Is `repoRoot` the repo's main checkout (~/Projects/diet-app, the tree systemd runs
 * and deploy lands into)? In a linked worktree git-dir points into `.git/worktrees/<name>`
 * while git-common-dir stays at the main `.git`; in the main checkout they are the same
 * path. `null` when git cannot answer at all (not installed, not a repo).
 */
export function isMainCheckout(repoRoot: string): boolean | null {
  try {
    const ask = (flag: string): string =>
      execFileSync('git', ['-C', repoRoot, 'rev-parse', '--path-format=absolute', flag], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: gitSafeEnv(),
      }).trim();
    return realpathSync(ask('--git-dir')) === realpathSync(ask('--git-common-dir'));
  } catch {
    return null;
  }
}

/** The slice of pg.Client lastAppliedWhen uses — a stub stands in for it in tests. */
export interface MigrationsClient {
  connect(): Promise<unknown>;
  query<R extends object>(sql: string): Promise<{ rows: R[] }>;
  end(): Promise<unknown>;
}

/** Postgres codes that mean "never migrated": undefined_table, invalid_schema_name. */
const FRESH_DATABASE_CODES = new Set(['42P01', '3F000']);

/**
 * The journal's `when` of the newest APPLIED migration, or null on a database that has
 * never been migrated. This is drizzle's own gate, not an approximation of it: its
 * migrator applies every journal entry whose `when` exceeds the single greatest
 * `created_at` in the table (drizzle-orm/pg-core/dialect.js). Takes an unconnected
 * client and always ends it.
 */
export async function lastAppliedWhen(client: MigrationsClient): Promise<number | null> {
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
    // not be spent as a value: the caller would compute pending from it.
    const code = (err as { code?: string }).code;
    if (code !== undefined && FRESH_DATABASE_CODES.has(code)) return null;
    throw err;
  } finally {
    await client.end();
  }
}
