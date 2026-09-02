// Unit tests for matchIngredientName and the SQL WHERE matchIngredientNames builds

import { describe, test, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  matchIngredientName,
  matchIngredientNames,
  type IngredientCandidate,
} from '../ingredient-match.js';

const CANDIDATES: IngredientCandidate[] = [
  { id: 'id-salt', name: 'Salt', aliases: ['sea salt', 'table salt'] },
  { id: 'id-egg', name: 'Egg', aliases: ['kananmuna'] },
  { id: 'id-basalt', name: 'Basalt spice', aliases: null },
  { id: 'id-salt-b', name: 'Salt', aliases: ['rock salt'] }, // duplicate name for stable pick
];

describe('matchIngredientName', () => {
  test('exact name match case-insensitive', () => {
    const m = matchIngredientName('EGG', [
      { id: 'id-egg', name: 'Egg', aliases: null },
    ]);
    expect(m).toEqual({
      rawName: 'EGG',
      ingredientId: 'id-egg',
      ingredientName: 'Egg',
      match: 'exact',
    });
  });

  test('alias match when name misses', () => {
    const m = matchIngredientName('kananmuna', CANDIDATES);
    expect(m.match).toBe('alias');
    expect(m.ingredientId).toBe('id-egg');
    // The review screen names the match it bound to, so the catalog name
    // travels with the id rather than costing a second round trip (#3237).
    expect(m.ingredientName).toBe('Egg');
  });

  test('name exact preferred over alias on another row', () => {
    const candidates: IngredientCandidate[] = [
      { id: 'id-a', name: 'Sea salt blend', aliases: ['salt'] },
      { id: 'id-b', name: 'Salt', aliases: null },
    ];
    const m = matchIngredientName('salt', candidates);
    expect(m).toEqual({
      rawName: 'salt',
      ingredientId: 'id-b',
      ingredientName: 'Salt',
      match: 'exact',
    });
  });

  test('none when no match', () => {
    const m = matchIngredientName('unicorn dust', CANDIDATES);
    expect(m).toEqual({
      rawName: 'unicorn dust',
      ingredientId: null,
      ingredientName: null,
      match: 'none',
    });
  });

  test('whitespace normalization', () => {
    const m = matchIngredientName('  sea   salt  ', CANDIDATES);
    expect(m.match).toBe('alias');
    expect(m.ingredientId).toBe('id-salt');
  });

  test('stable tie-break when multiple name exact (name ASC, id ASC)', () => {
    const m = matchIngredientName('Salt', CANDIDATES);
    // Both id-salt and id-salt-b have name Salt; name ASC ties, id ASC → id-salt
    expect(m.match).toBe('exact');
    expect(m.ingredientId).toBe('id-salt');
  });
});

describe('matchIngredientNames SQL', () => {
  const dialect = new PgDialect();

  function capturingDb(rows: IngredientCandidate[]) {
    let where: unknown;
    const db = {
      select: () => ({
        from: () => ({
          where: (w: unknown) => {
            where = w;
            return Promise.resolve(rows);
          },
        }),
      }),
    };
    return {
      db: db as never,
      rendered: () => dialect.sqlToQuery(where as never),
    };
  }

  test('WHERE is unnest + bound IN, never string-concat SQL', async () => {
    const injection = "x'; DROP TABLE ingredients;--";
    const { db, rendered } = capturingDb([
      { id: 'id-chicken', name: 'chicken', aliases: ['kana'] },
      { id: 'id-potato', name: 'potato', aliases: ['peruna'] },
    ]);

    const result = await matchIngredientNames(db, ['Chicken', 'peruna', 'unicorn', injection]);
    expect(result).toEqual([
      { rawName: 'Chicken', ingredientId: 'id-chicken', ingredientName: 'chicken', match: 'exact' },
      { rawName: 'peruna', ingredientId: 'id-potato', ingredientName: 'potato', match: 'alias' },
      { rawName: 'unicorn', ingredientId: null, ingredientName: null, match: 'none' },
      { rawName: injection, ingredientId: null, ingredientName: null, match: 'none' },
    ]);

    const q = rendered();
    expect(q.sql).toContain('unnest(coalesce(');
    expect(q.sql).toContain('array[]::text[]');
    expect(q.sql).toMatch(/lower\([^)]*name[^)]*\) IN \(/i);
    expect(q.sql).toMatch(/lower\(a\.alias\) IN \(/i);
    // Needles are bound params (twice: name IN and alias IN), never interpolated.
    expect(q.sql).not.toContain('chicken');
    expect(q.sql).not.toContain('peruna');
    expect(q.sql).not.toContain('DROP TABLE');
    const needles = ['chicken', 'peruna', 'unicorn', injection.toLowerCase()];
    expect(q.params).toEqual([...needles, ...needles]);
  });

  test('empty / whitespace-only names skip the query', async () => {
    const db = {
      select: () => {
        throw new Error('matchIngredientNames must not query when every name is blank');
      },
    };
    await expect(matchIngredientNames(db as never, [])).resolves.toEqual([]);
    await expect(matchIngredientNames(db as never, ['  ', ''])).resolves.toEqual([
      { rawName: '  ', ingredientId: null, ingredientName: null, match: 'none' },
      { rawName: '', ingredientId: null, ingredientName: null, match: 'none' },
    ]);
  });
});
