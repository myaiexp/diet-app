// May this `pnpm migrate` run from here? — the verdict and its refusal text

import { describe, it, expect } from 'vitest';
import { decideMigrate, pendingMigrations, renderRefusal, type PendingMigration } from '../migrate-guard.js';

const destructive = (tag: string): PendingMigration => ({
  tag,
  findings: [
    {
      line: 9,
      kind: 'DROP COLUMN',
      statement: 'ALTER TABLE "user_profile" DROP COLUMN "disliked_ingredient_ids"',
    },
  ],
});
const additive = (tag: string): PendingMigration => ({ tag, findings: [] });

describe('decideMigrate', () => {
  it('refuses destructive pending DDL from a worktree', () => {
    const v = decideMigrate({
      mainCheckout: false,
      pending: [destructive('0004_x')],
      force: false,
    });
    expect(v).toEqual({ action: 'refuse', offenders: [destructive('0004_x')] });
  });

  it('allows destructive DDL from the main checkout — that IS the tree prod runs', () => {
    expect(
      decideMigrate({ mainCheckout: true, pending: [destructive('0004_x')], force: false }),
    ).toEqual({ action: 'run' });
  });

  it('allows additive migrations from a worktree, which is the common case', () => {
    expect(
      decideMigrate({ mainCheckout: false, pending: [additive('0005_x')], force: false }),
    ).toEqual({ action: 'run' });
  });

  it('treats an unanswerable git as not-the-main-checkout', () => {
    const v = decideMigrate({
      mainCheckout: null,
      pending: [destructive('0004_x')],
      force: false,
    });
    expect(v.action).toBe('refuse');
  });

  it('honours --force', () => {
    expect(
      decideMigrate({ mainCheckout: false, pending: [destructive('0004_x')], force: true }),
    ).toEqual({ action: 'run' });
  });

  it('ignores an already-applied destructive migration — only pending ones can bite', () => {
    // The caller filters by drizzle's own gate; nothing pending means nothing to refuse,
    // even though drizzle/0001 is destructive and stays on disk forever.
    expect(decideMigrate({ mainCheckout: false, pending: [], force: false })).toEqual({
      action: 'run',
    });
  });

  it('reports only the offending members of a mixed pending set', () => {
    const v = decideMigrate({
      mainCheckout: false,
      pending: [additive('0005_x'), destructive('0006_y')],
      force: false,
    });
    expect(v).toEqual({ action: 'refuse', offenders: [destructive('0006_y')] });
  });
});

describe('renderRefusal', () => {
  it('names the file, line, kind and statement of every finding', () => {
    const text = renderRefusal([destructive('0004_x')], { mainCheckout: false });
    expect(text).toContain('drizzle/0004_x.sql');
    expect(text).toContain('L9');
    expect(text).toContain('DROP COLUMN');
    expect(text).toContain('ALTER TABLE "user_profile" DROP COLUMN "disliked_ingredient_ids"');
  });

  it('points at deploy as the resolution and names the override', () => {
    const text = renderRefusal([destructive('0004_x')], { mainCheckout: false });
    expect(text).toContain('deploy');
    expect(text).toContain('--force');
  });

  it('says so when git could not answer, rather than claiming a worktree', () => {
    expect(renderRefusal([destructive('0004_x')], { mainCheckout: null })).toContain(
      'git could not say',
    );
    expect(renderRefusal([destructive('0004_x')], { mainCheckout: false })).toContain(
      'this is a worktree',
    );
  });
});

describe('pendingMigrations', () => {
  const drop = 'ALTER TABLE t DROP COLUMN c;';
  const add = 'ALTER TABLE t ADD COLUMN c text;';

  it('treats a null applied timestamp as every journal entry, in order', () => {
    const reads: string[] = [];
    const pending = pendingMigrations(
      [
        { tag: '0002_b', when: 20 },
        { tag: '0001_a', when: 10 },
      ],
      null,
      (tag) => {
        reads.push(tag);
        return tag === '0001_a' ? drop : add;
      },
    );
    expect(reads).toEqual(['0002_b', '0001_a']);
    expect(pending.map((p) => p.tag)).toEqual(['0002_b', '0001_a']);
    expect(pending[0]?.findings).toEqual([]);
    expect(pending[1]?.findings.map((f) => f.kind)).toEqual(['DROP COLUMN']);
  });

  it('excludes an entry whose when equals the newest applied, and does not read its SQL', () => {
    const reads: string[] = [];
    const pending = pendingMigrations(
      [
        { tag: 'old', when: 10 },
        { tag: 'applied', when: 20 },
        { tag: 'next', when: 30 },
      ],
      20,
      (tag) => {
        reads.push(tag);
        return drop;
      },
    );
    expect(reads).toEqual(['next']);
    expect(pending.map((p) => p.tag)).toEqual(['next']);
  });

  it('compares when numerically, so 10 is after 9', () => {
    const reads: string[] = [];
    const pending = pendingMigrations(
      [
        { tag: 'ten', when: 10 },
        { tag: 'nine', when: 9 },
      ],
      9,
      (tag) => {
        reads.push(tag);
        return add;
      },
    );
    // String compare says "10" < "9", which would drop the entry that is actually pending.
    expect(reads).toEqual(['ten']);
    expect(pending.map((p) => p.tag)).toEqual(['ten']);
  });
});
