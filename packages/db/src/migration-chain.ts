// Checks drizzle/ is one linear migration chain (journal, files, snapshot links)
//
// Migration numbering is first-come: two sessions on two branches each run `generate`
// and both get the next index. Git surfaces that as a conflict in _journal.json, and a
// hand resolution (keep both, renumber one) can leave a chain drizzle-kit and the
// migrator disagree about — a duplicate idx, a snapshot whose prevId points at the
// wrong parent, or a renumbered entry that kept its older `when`. That last one is the
// silent kind: the migrator applies only entries whose `when` exceeds the newest applied
// row, so every database that has the entry before it never applies it. The test suite
// runs these checks against the real folder, so a bad resolution fails before deploy.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** drizzle-kit's prevId for the first snapshot. */
export const ZERO_SNAPSHOT_ID = '00000000-0000-0000-0000-000000000000';

export interface ChainEntry {
  idx: number;
  tag: string;
  when: number;
}

export interface ChainSnapshot {
  /** File name under meta/, e.g. '0003_snapshot.json'. */
  file: string;
  id: string;
  prevId: string;
}

export interface MigrationChain {
  /** Journal entries in journal order. */
  entries: ChainEntry[];
  /** `.sql` file names directly under the migrations folder. */
  sqlFiles: string[];
  /** Every `NNNN_snapshot.json` under meta/, in file-name order. */
  snapshots: ChainSnapshot[];
}

const pad = (n: number): string => String(n).padStart(4, '0');

export function readChain(migrationsFolder: string): MigrationChain {
  const meta = join(migrationsFolder, 'meta');
  const { entries } = JSON.parse(readFileSync(join(meta, '_journal.json'), 'utf8')) as {
    entries: ChainEntry[];
  };
  const sqlFiles = readdirSync(migrationsFolder).filter((f) => f.endsWith('.sql')).sort();
  const snapshots = readdirSync(meta)
    .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
    .sort()
    .map((file) => {
      const { id, prevId } = JSON.parse(readFileSync(join(meta, file), 'utf8')) as ChainSnapshot;
      return { file, id, prevId };
    });
  return { entries, sqlFiles, snapshots };
}

/** One sentence per problem; empty when the chain is consistent. */
export function findChainProblems({ entries, sqlFiles, snapshots }: MigrationChain): string[] {
  const problems: string[] = [];
  const sqlSet = new Set(sqlFiles);
  const snapshotByFile = new Map(snapshots.map((s) => [s.file, s]));
  const journalTags = new Set(entries.map((e) => e.tag));

  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      problems.push(`${entry.tag}: journal idx ${entry.idx} at position ${position}`);
    }
    const number = /^(\d{4})_/.exec(entry.tag)?.[1];
    if (number !== pad(entry.idx)) {
      problems.push(`${entry.tag}: tag number ${number ?? '(none)'} does not match idx ${entry.idx}`);
    }
    const prev = entries[position - 1];
    if (prev && !(entry.when > prev.when)) {
      problems.push(
        `${entry.tag}: when ${entry.when} is not later than ${prev.tag}'s ${prev.when}, so a ` +
          'database that applied the earlier one never applies this one',
      );
    }
    if (!sqlSet.has(`${entry.tag}.sql`)) {
      problems.push(`${entry.tag}: no drizzle/${entry.tag}.sql`);
    }
    if (!snapshotByFile.has(`${pad(position)}_snapshot.json`)) {
      problems.push(`${entry.tag}: no meta/${pad(position)}_snapshot.json`);
    }
  });

  for (const file of sqlFiles) {
    if (!journalTags.has(file.replace(/\.sql$/, ''))) {
      problems.push(`${file}: the journal does not name it`);
    }
  }

  const seenIds = new Map<string, string>();
  snapshots.forEach((snapshot) => {
    const position = Number(snapshot.file.slice(0, 4));
    if (position >= entries.length) {
      problems.push(`${snapshot.file}: no journal entry at idx ${position}`);
    }
    const parent = position === 0 ? undefined : snapshotByFile.get(`${pad(position - 1)}_snapshot.json`);
    const expected = position === 0 ? ZERO_SNAPSHOT_ID : parent?.id;
    if (expected !== undefined && snapshot.prevId !== expected) {
      problems.push(
        position === 0
          ? `${snapshot.file}: prevId ${snapshot.prevId}, expected the zero id`
          : `${snapshot.file}: prevId ${snapshot.prevId}, but ${parent!.file} has id ${expected}`,
      );
    }
    const clash = seenIds.get(snapshot.id);
    if (clash) problems.push(`${snapshot.file}: id ${snapshot.id} is also ${clash}'s id`);
    seenIds.set(snapshot.id, snapshot.file);
  });

  return problems;
}
