// Migration chain consistency: journal order, file pairing, snapshot prevId links

import { describe, test, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findChainProblems, readChain, type MigrationChain } from '../migration-chain.js';

const ZERO = '00000000-0000-0000-0000-000000000000';

function chain(): MigrationChain {
  return {
    entries: [
      { idx: 0, tag: '0000_first', when: 100 },
      { idx: 1, tag: '0001_second', when: 200 },
      { idx: 2, tag: '0002_third', when: 300 },
    ],
    sqlFiles: ['0000_first.sql', '0001_second.sql', '0002_third.sql'],
    snapshots: [
      { file: '0000_snapshot.json', id: 'a', prevId: ZERO },
      { file: '0001_snapshot.json', id: 'b', prevId: 'a' },
      { file: '0002_snapshot.json', id: 'c', prevId: 'b' },
    ],
  };
}

describe('findChainProblems', () => {
  test('a consistent chain has no problems', () => {
    expect(findChainProblems(chain())).toEqual([]);
  });

  test('the repo’s own drizzle folder is consistent', () => {
    const folder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
    expect(findChainProblems(readChain(folder))).toEqual([]);
  });

  test('two migrations sharing an index — the parallel-session collision', () => {
    const c = chain();
    c.entries[2] = { idx: 1, tag: '0001_other_branch', when: 300 };
    c.sqlFiles[2] = '0001_other_branch.sql';
    expect(findChainProblems(c).join('\n')).toMatch(/0001_other_branch.*idx 1.*position 2/);
  });

  test('a tag whose number disagrees with its idx', () => {
    const c = chain();
    c.entries[2] = { idx: 2, tag: '0003_third', when: 300 };
    c.sqlFiles[2] = '0003_third.sql';
    expect(findChainProblems(c).join('\n')).toMatch(/0003_third.*number 0003.*idx 2/);
  });

  test('a `when` not later than the entry before it, which drizzle would skip', () => {
    // A hand-renumbered migration keeps its original, older `when`: any database that
    // already applied the migration before it never applies this one.
    const c = chain();
    c.entries[2] = { idx: 2, tag: '0002_third', when: 150 };
    expect(findChainProblems(c).join('\n')).toMatch(/0002_third.*when 150.*0001_second.*200/);
  });

  test('a journal entry with no .sql file, and a .sql file the journal does not name', () => {
    const c = chain();
    c.sqlFiles = ['0000_first.sql', '0001_second.sql', '0002_stray.sql'];
    const text = findChainProblems(c).join('\n');
    expect(text).toMatch(/0002_third.*no drizzle\/0002_third\.sql/);
    expect(text).toMatch(/0002_stray\.sql.*journal does not name/);
  });

  test('a missing snapshot, and a snapshot with no journal entry', () => {
    const c = chain();
    c.snapshots = [c.snapshots[0]!, c.snapshots[1]!, { file: '0003_snapshot.json', id: 'c', prevId: 'b' }];
    const text = findChainProblems(c).join('\n');
    expect(text).toMatch(/0002_third.*no meta\/0002_snapshot\.json/);
    expect(text).toMatch(/0003_snapshot\.json.*no journal entry/);
  });

  test('a snapshot whose prevId does not point at the one before it', () => {
    const c = chain();
    c.snapshots[2] = { file: '0002_snapshot.json', id: 'c', prevId: 'a' };
    expect(findChainProblems(c).join('\n')).toMatch(/0002_snapshot\.json.*prevId a.*0001_snapshot\.json.*id b/);
  });

  test('the first snapshot must start from the zero id', () => {
    const c = chain();
    c.snapshots[0] = { file: '0000_snapshot.json', id: 'a', prevId: 'z' };
    expect(findChainProblems(c).join('\n')).toMatch(/0000_snapshot\.json.*prevId z/);
  });

  test('two snapshots with the same id', () => {
    const c = chain();
    c.snapshots[2] = { file: '0002_snapshot.json', id: 'b', prevId: 'b' };
    expect(findChainProblems(c).join('\n')).toMatch(/0002_snapshot\.json.*id b.*0001_snapshot\.json/);
  });
});
