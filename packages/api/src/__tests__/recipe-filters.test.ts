// Unit tests for buildTagsCondition — renders the Drizzle SQL to its final
// parameterized form (via PgDialect) so we assert the ACTUAL array literal and
// bound params, not just that "a condition exists". Covers the multi-tag bug
// (audit #recipes-tags-multivalue): ?tags=pasta,italian must produce a
// two-element array, not one literal tag "pasta,italian".

import { describe, test, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildTagsCondition } from '../routes/recipe-filters.js';

const dialect = new PgDialect();
const render = (raw: string) => dialect.sqlToQuery(buildTagsCondition(raw)!);

describe('buildTagsCondition', () => {
  test('single tag → one-element array bound as one param', () => {
    const q = render('pasta');
    expect(q.sql).toContain('@> ARRAY[$1]::text[]');
    expect(q.params).toEqual(['pasta']);
  });

  test('comma-separated → multi-element array, one param per tag (the bug fix)', () => {
    const q = render('pasta,italian');
    expect(q.sql).toContain('@> ARRAY[$1, $2]::text[]');
    expect(q.params).toEqual(['pasta', 'italian']);
  });

  test('trims surrounding whitespace and drops empty segments', () => {
    const q = render(' pasta , , italian ');
    expect(q.sql).toContain('@> ARRAY[$1, $2]::text[]');
    expect(q.params).toEqual(['pasta', 'italian']);
  });

  test('tags are bound params, never interpolated — injection-style value is inert', () => {
    const q = render("italian'; DROP TABLE recipes;--");
    // The whole value survives intact as a single bound param: no SQL breakout.
    expect(q.params).toEqual(["italian'; DROP TABLE recipes;--"]);
    expect(q.sql).toContain('@> ARRAY[$1]::text[]');
    expect(q.sql).not.toContain('DROP TABLE');
  });

  test('empty / whitespace / commas-only → undefined (no WHERE clause added)', () => {
    expect(buildTagsCondition('')).toBeUndefined();
    expect(buildTagsCondition('   ')).toBeUndefined();
    expect(buildTagsCondition(' , , ')).toBeUndefined();
  });
});
