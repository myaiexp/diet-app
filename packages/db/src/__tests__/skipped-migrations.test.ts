// Skipped-migration detection: journal entries drizzle's `when` gate will never apply

import { describe, test, expect } from 'vitest';
import { findSkippedMigrations, renderSkipped } from '../skipped-migrations.js';

const journal = [
  { tag: '0000_a', when: 100, hash: 'hash-a' },
  { tag: '0001_b', when: 200, hash: 'hash-b' },
  { tag: '0002_c', when: 300, hash: 'hash-c' },
];

describe('findSkippedMigrations', () => {
  test('a fresh database skips nothing', () => {
    expect(findSkippedMigrations(journal, [])).toEqual([]);
  });

  test('pending migrations newer than every applied row are not skipped', () => {
    expect(findSkippedMigrations(journal, [{ hash: 'hash-a', createdAt: 100 }])).toEqual([]);
  });

  test('an unapplied entry older than the newest applied row is skipped', () => {
    // Another branch's migration (generated later, applied from its worktree) sits at
    // 250: drizzle's gate is `when > 250`, so 0001_b never runs here.
    const applied = [
      { hash: 'hash-a', createdAt: 100 },
      { hash: 'hash-from-another-branch', createdAt: 250 },
    ];
    expect(findSkippedMigrations(journal, applied)).toEqual([journal[1]]);
  });

  test('an entry equal to the newest applied time counts as skipped when its hash is absent', () => {
    // The gate is strict `>`, so an equal `when` is treated as already applied.
    const applied = [{ hash: 'hash-other', createdAt: 200 }];
    expect(findSkippedMigrations(journal, applied).map((m) => m.tag)).toEqual(['0000_a', '0001_b']);
  });

  test('an applied entry recorded at a different time is drift, not a skip — but it hides the ones after it', () => {
    // 0001_b ran (its hash is recorded), so it is journal-drift's case. Its inflated
    // created_at still raises the gate past 0002_c, which drizzle therefore skips.
    const applied = [
      { hash: 'hash-a', createdAt: 100 },
      { hash: 'hash-b', createdAt: 999 },
    ];
    expect(findSkippedMigrations(journal, applied).map((m) => m.tag)).toEqual(['0002_c']);
  });
});

describe('renderSkipped', () => {
  test('names each migration, its when, and the newest applied time', () => {
    const text = renderSkipped([journal[1]!], 250);
    expect(text).toContain('0001_b');
    expect(text).toContain('200');
    expect(text).toContain('250');
  });
});
