// The DDL classifier behind the migrate guard, incl. diet-app's own migrations

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { blankSqlNoise, findDestructiveDdl } from '../destructive-ddl.js';

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

const kinds = (sql: string): string[] => findDestructiveDdl(sql).map((f) => f.kind);

describe('blankSqlNoise', () => {
  it('preserves length and line structure so offsets survive', () => {
    const sql = "-- drop everything\nSELECT 'x';\n/* gone */\n";
    const blanked = blankSqlNoise(sql);
    expect(blanked).toHaveLength(sql.length);
    expect(blanked.split('\n')).toHaveLength(sql.split('\n').length);
  });

  it('blanks line comments, block comments, and string literals', () => {
    const blanked = blankSqlNoise("-- DROP TABLE a\n/* DROP TABLE b */ SELECT 'DROP TABLE c';");
    expect(blanked).not.toMatch(/DROP/);
    expect(blanked).toMatch(/SELECT/);
  });

  it('handles nested block comments (Postgres nests them)', () => {
    const blanked = blankSqlNoise('/* outer /* inner */ still comment */ DROP TABLE t;');
    expect(blanked).toMatch(/DROP TABLE t/);
    expect(blanked).not.toMatch(/inner/);
  });

  it('handles doubled-quote escapes without swallowing the rest of the file', () => {
    const blanked = blankSqlNoise("SELECT 'it''s fine'; DROP TABLE t;");
    expect(blanked).toMatch(/DROP TABLE t/);
    expect(blanked).not.toMatch(/fine/);
  });

  it('handles dollar-quoted bodies', () => {
    const blanked = blankSqlNoise(
      'CREATE FUNCTION f() RETURNS void AS $body$ DROP TABLE inner_t; $body$ LANGUAGE sql;',
    );
    expect(blanked).not.toMatch(/inner_t/);
  });

  it('leaves a bare $1 placeholder alone', () => {
    expect(blankSqlNoise('UPDATE t SET a = $1 WHERE b = $2;')).toContain('$1');
  });
});

describe('findDestructiveDdl — destructive statements', () => {
  it.each([
    ['ALTER TABLE t DROP COLUMN IF EXISTS c;', 'DROP COLUMN'],
    ['ALTER TABLE t DROP c;', 'DROP COLUMN'], // the COLUMN keyword is optional in Postgres
    ['DROP TABLE IF EXISTS t;', 'DROP TABLE'],
    ['DROP MATERIALIZED VIEW v;', 'DROP VIEW'],
    ['DROP INDEX idx;', 'DROP INDEX'],
    ['DROP TYPE mood;', 'DROP TYPE'],
    ['ALTER TABLE t DROP CONSTRAINT t_pkey;', 'DROP CONSTRAINT'],
    ['ALTER TABLE t ALTER COLUMN c DROP DEFAULT;', 'DROP DEFAULT'],
    ['ALTER TABLE t RENAME COLUMN a TO b;', 'RENAME'],
    ['ALTER TABLE t ALTER COLUMN c SET NOT NULL;', 'SET NOT NULL'],
    ['ALTER TABLE t ALTER COLUMN c TYPE integer;', 'ALTER COLUMN TYPE'],
    ['ALTER TABLE t ALTER COLUMN c SET DATA TYPE integer;', 'ALTER COLUMN TYPE'],
    ['TRUNCATE pantry_items;', 'TRUNCATE'],
    ['DELETE FROM pantry_items;', 'DELETE'],
  ])('flags %s as %s', (sql, kind) => {
    expect(kinds(sql)).toContain(kind);
  });
});

describe('findDestructiveDdl — statements that must NOT be flagged', () => {
  it.each([
    'ALTER TABLE t ADD COLUMN IF NOT EXISTS c text;',
    'CREATE TABLE IF NOT EXISTS t (id serial primary key, c text NOT NULL);',
    'CREATE INDEX IF NOT EXISTS idx ON t (c);',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx ON t (c);',
    'ALTER TABLE t ALTER COLUMN c DROP NOT NULL;', // relaxing — never breaks older code
    "ALTER TYPE mood ADD VALUE IF NOT EXISTS 'ok';", // additive enum value
    "UPDATE t SET c = 'x' WHERE c IS NULL;",
    'ALTER TABLE t ADD CONSTRAINT t_chk CHECK (c > 0);',
    // `ON DELETE`/`SET NULL` inside a foreign key is referential action, not a DELETE.
    'ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES u(id) ON DELETE CASCADE;',
    'CREATE TABLE t (a integer REFERENCES u(id) ON DELETE SET NULL);',
  ])('leaves %s alone', (sql) => {
    expect(findDestructiveDdl(sql)).toEqual([]);
  });

  it('does not flag prose that merely describes a drop', () => {
    const sql = [
      '-- 0099_notes',
      '-- We will DROP COLUMN shelf_life in a later migration; TRUNCATE is never used.',
      '/* DROP TABLE pantry_items would be wrong here. */',
      'ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS location text;',
    ].join('\n');
    expect(findDestructiveDdl(sql)).toEqual([]);
  });
});

describe('findDestructiveDdl — reporting', () => {
  it('reports the line of the keyword, not of the leading comment block', () => {
    const sql = ['-- a comment', '-- another comment', '', 'ALTER TABLE t DROP COLUMN c;'].join('\n');
    expect(findDestructiveDdl(sql)).toEqual([
      { line: 4, kind: 'DROP COLUMN', statement: 'ALTER TABLE t DROP COLUMN c' },
    ]);
  });

  it('excerpts the statement without its preceding comments', () => {
    expect(findDestructiveDdl('-- explanation of why\nDROP TABLE t;')[0]!.statement).toBe(
      'DROP TABLE t',
    );
  });

  it('keeps quoted identifiers in the excerpt', () => {
    // Identifiers are blanked for SCANNING only. Excerpting off the blanked copy trims
    // a trailing `"column"` away and prints a statement that looks truncated.
    expect(
      findDestructiveDdl('ALTER TABLE "user_profile" DROP COLUMN "disliked_ingredient_ids";')[0]!
        .statement,
    ).toBe('ALTER TABLE "user_profile" DROP COLUMN "disliked_ingredient_ids"');
  });

  it('still refuses to scan inside a quoted identifier', () => {
    // A column named "drop" is not a DROP — that is why identifiers are blanked at all.
    expect(findDestructiveDdl('ALTER TABLE t ADD COLUMN IF NOT EXISTS "drop" text;')).toEqual([]);
  });

  it('reports one finding per kind, in file order', () => {
    const sql = [
      'ALTER TABLE t DROP COLUMN a;',
      'ALTER TABLE t DROP COLUMN b;',
      'DROP TABLE u;',
    ].join('\n');
    expect(findDestructiveDdl(sql).map((f) => [f.line, f.kind])).toEqual([
      [1, 'DROP COLUMN'],
      [2, 'DROP COLUMN'],
      [3, 'DROP TABLE'],
    ]);
  });

  it('tolerates a final statement with no trailing semicolon', () => {
    expect(kinds('DROP TABLE t')).toEqual(['DROP TABLE']);
  });

  it('ignores drizzle statement-breakpoint markers', () => {
    const sql =
      'ALTER TABLE t ADD COLUMN c text;\n--> statement-breakpoint\nCREATE INDEX idx ON t (c);';
    expect(findDestructiveDdl(sql)).toEqual([]);
  });
});

describe('findDestructiveDdl — against diet-app’s real migrations', () => {
  const read = (tag: string) => readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');

  it('flags the user_profile column drop in 0001', () => {
    expect(kinds(read('0001_gigantic_wild_pack'))).toContain('DROP COLUMN');
  });

  it('flags the SET NOT NULL tightenings in 0002', () => {
    // An INSERT that omits the column starts failing the moment this lands, which is
    // exactly the shape that must not be applied ahead of the code.
    expect(kinds(read('0002_condemned_the_spike'))).toContain('SET NOT NULL');
  });

  it('leaves the purely additive migrations alone', () => {
    // The false-positive half: 0000 creates the whole schema and 0003 adds the products
    // table. If routine CREATE/ADD work started tripping the scan, `pnpm migrate` would
    // refuse the common case from every worktree.
    expect(findDestructiveDdl(read('0000_hesitant_praxagora'))).toEqual([]);
    expect(findDestructiveDdl(read('0003_glorious_serpent_society'))).toEqual([]);
  });

  it('flags a minority of the corpus, not most of it', () => {
    const all = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'));
    const flagged = all.filter((f) => findDestructiveDdl(readFileSync(join(DRIZZLE_DIR, f), 'utf8')).length > 0);
    expect(all.length).toBeGreaterThan(0);
    expect(flagged.length / all.length).toBeLessThan(0.6);
  });
});
