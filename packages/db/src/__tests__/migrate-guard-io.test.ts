// The migrate guard's git and pg reads — the failures that would disarm it, not trip it

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GIT_LOCATION_VARS,
  gitSafeEnv,
  isMainCheckout,
  lastAppliedWhen,
  type MigrationsClient,
} from '../migrate-guard-io.js';

describe('gitSafeEnv', () => {
  it('drops every git location var and keeps the rest', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/home/x' };
    for (const key of GIT_LOCATION_VARS) env[key] = '/elsewhere';
    expect(gitSafeEnv(env)).toEqual({ PATH: '/usr/bin', HOME: '/home/x' });
  });
});

describe('isMainCheckout', () => {
  let root: string;
  let main: string;
  let worktree: string;

  // Setup git calls use the stripped env too: under a pre-commit hook an inherited
  // GIT_DIR would point `git init`/`commit` at the real repo instead of the tempdir.
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitSafeEnv(),
    }).trim();

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'migrate-guard-io-')));
    main = join(root, 'main');
    worktree = join(root, 'wt');
    execFileSync('git', ['init', '-q', main], { env: gitSafeEnv() });
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    git(main, 'worktree', 'add', '-q', '-b', 'wt', worktree);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers true in the main checkout and false in a linked worktree', () => {
    expect(isMainCheckout(main)).toBe(true);
    expect(isMainCheckout(worktree)).toBe(false);
  });

  it('answers about repoRoot, not an inherited GIT_DIR naming the main checkout', () => {
    vi.stubEnv('GIT_DIR', join(main, '.git'));
    vi.stubEnv('GIT_WORK_TREE', main);
    // Control: an unstripped git call really is hijacked by these vars, so the
    // assertion below is only green because isMainCheckout strips them.
    const hijacked = execFileSync(
      'git',
      ['-C', worktree, 'rev-parse', '--path-format=absolute', '--git-dir'],
      { encoding: 'utf8' },
    ).trim();
    expect(hijacked).toBe(join(main, '.git'));

    expect(isMainCheckout(worktree)).toBe(false);
  });

  it('answers about repoRoot, not an inherited GIT_DIR naming a worktree', () => {
    vi.stubEnv('GIT_DIR', git(worktree, 'rev-parse', '--path-format=absolute', '--git-dir'));
    vi.stubEnv('GIT_COMMON_DIR', join(main, '.git'));
    expect(isMainCheckout(main)).toBe(true);
  });

  it('returns null outside any repo', () => {
    const bare = mkdtempSync(join(root, 'not-a-repo-'));
    expect(isMainCheckout(bare)).toBeNull();
  });

  it('returns null when git is not on PATH', () => {
    vi.stubEnv('PATH', join(root, 'no-such-bin-dir'));
    expect(isMainCheckout(main)).toBeNull();
  });
});

describe('lastAppliedWhen', () => {
  /** A stub client whose query resolves to `rows` or rejects with `error`. */
  function stub(outcome: { rows: object[] } | { error: unknown }) {
    const calls: string[] = [];
    const client: MigrationsClient = {
      connect: async () => void calls.push('connect'),
      query: async <R extends object>() => {
        calls.push('query');
        if ('error' in outcome) throw outcome.error;
        return { rows: outcome.rows as R[] };
      },
      end: async () => void calls.push('end'),
    };
    return { client, calls };
  }

  const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

  it('returns the newest created_at as a number', async () => {
    // pg returns bigint columns as strings.
    const { client, calls } = stub({ rows: [{ created_at: '1755820800000' }] });
    await expect(lastAppliedWhen(client)).resolves.toBe(1755820800000);
    expect(calls).toEqual(['connect', 'query', 'end']);
  });

  it('returns null on an empty migrations table', async () => {
    const { client } = stub({ rows: [] });
    await expect(lastAppliedWhen(client)).resolves.toBeNull();
  });

  it.each(['42P01', '3F000'])('reads %s (no migrations table/schema) as a fresh database', async (code) => {
    const { client, calls } = stub({ error: pgError(code) });
    await expect(lastAppliedWhen(client)).resolves.toBeNull();
    expect(calls).toEqual(['connect', 'query', 'end']);
  });

  it.each(['42501', '57P01', '08006', '28P01'])('rethrows %s instead of spending it as a value', async (code) => {
    const err = pgError(code);
    const { client, calls } = stub({ error: err });
    await expect(lastAppliedWhen(client)).rejects.toBe(err);
    expect(calls).toEqual(['connect', 'query', 'end']);
  });

  it('rethrows an error with no code at all', async () => {
    const err = new Error('socket hang up');
    const { client } = stub({ error: err });
    await expect(lastAppliedWhen(client)).rejects.toBe(err);
  });
});
