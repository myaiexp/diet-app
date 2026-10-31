// Journal drift detection and the migration error text — no Postgres needed

import { describe, test, expect } from 'vitest';
import { findJournalDrift, renderDrift } from '../journal-drift.js';
import { describeMigrationError } from '../apply-migrations.js';

const journal = [
  { tag: '0000_a', when: 100, hash: 'hash-a' },
  { tag: '0001_b', when: 200, hash: 'hash-b' },
  { tag: '0002_c', when: 300, hash: 'hash-c' },
];

describe('findJournalDrift', () => {
  test('a database that matches the journal has no drift', () => {
    const applied = [
      { hash: 'hash-a', createdAt: 100 },
      { hash: 'hash-b', createdAt: 200 },
    ];
    expect(findJournalDrift(journal, applied)).toEqual([]);
  });

  test('reports an applied migration whose recorded time differs from the journal', () => {
    const applied = [
      { hash: 'hash-a', createdAt: 100 },
      { hash: 'hash-b', createdAt: 150 },
    ];
    expect(findJournalDrift(journal, applied)).toEqual([
      { tag: '0001_b', hash: 'hash-b', recorded: 150, when: 200 },
    ]);
  });

  test('a recorded time newer than the journal is drift too', () => {
    // It would hide any pending migration older than the recorded time.
    expect(findJournalDrift(journal, [{ hash: 'hash-a', createdAt: 900 }])).toHaveLength(1);
  });

  test('a pending migration, and a row from another branch, are not drift', () => {
    // Every worktree shares dietapp_test, so a row this checkout's journal does
    // not name is another branch's migration, and is left alone.
    const applied = [{ hash: 'hash-from-another-branch', createdAt: 250 }];
    expect(findJournalDrift(journal, applied)).toEqual([]);
  });
});

describe('renderDrift', () => {
  test('names each migration with both timestamps', () => {
    const text = renderDrift([{ tag: '0001_b', hash: 'hash-b', recorded: 150, when: 200 }]);
    expect(text).toContain('0001_b');
    expect(text).toContain('150');
    expect(text).toContain('200');
  });
});

describe('describeMigrationError', () => {
  test('walks the cause chain down to the Postgres message', () => {
    const pgError = Object.assign(new Error('relation "products" already exists'), { code: '42P07' });
    const wrapped = new Error('Failed query: CREATE TABLE "products"', { cause: pgError });

    const text = describeMigrationError(wrapped);

    expect(text).toContain('Failed query: CREATE TABLE "products"');
    expect(text).toContain('relation "products" already exists');
    expect(text).toContain('42P07');
  });

  test('copes with a thrown non-Error', () => {
    expect(describeMigrationError('boom')).toBe('boom');
  });
});
