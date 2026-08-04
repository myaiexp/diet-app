// Shopping list item ordering coverage (staple grouping + total order)

import { describe, test, expect } from 'vitest';
import { sortListItems, type SortableItem } from '../shopping-sort.js';

const item = (over: Partial<SortableItem> & { id: string }): SortableItem => ({
  category: 'produce',
  ingredient: { name: 'thing', isPantryStaple: false },
  ...over,
});

const ids = (rows: SortableItem[]) => rows.map((r) => r.id);

describe('sortListItems', () => {
  test('places non-staples before staples', () => {
    const rows = [
      item({ id: 'a', ingredient: { name: 'salt', isPantryStaple: true } }),
      item({ id: 'b', ingredient: { name: 'chicken', isPantryStaple: false } }),
    ];
    expect(ids(sortListItems(rows))).toEqual(['b', 'a']);
  });

  test('sorts by category alphabetically within a staple group', () => {
    const rows = [
      item({ id: 'a', category: 'produce' }),
      item({ id: 'b', category: 'dairy' }),
      item({ id: 'c', category: 'condiment' }),
    ];
    expect(ids(sortListItems(rows))).toEqual(['c', 'b', 'a']);
  });

  test('sorts by ingredient name within a category', () => {
    const rows = [
      item({ id: 'a', ingredient: { name: 'onion', isPantryStaple: false } }),
      item({ id: 'b', ingredient: { name: 'apple', isPantryStaple: false } }),
    ];
    expect(ids(sortListItems(rows))).toEqual(['b', 'a']);
  });

  test('tie-breaks on id', () => {
    const rows = [item({ id: 'z' }), item({ id: 'a' }), item({ id: 'm' })];
    expect(ids(sortListItems(rows))).toEqual(['a', 'm', 'z']);
  });

  test('treats a null or missing ingredient as a non-staple with an empty name', () => {
    const rows = [
      item({ id: 'staple', ingredient: { name: 'aaa', isPantryStaple: true } }),
      item({ id: 'nullish', ingredient: null }),
      item({ id: 'absent', ingredient: undefined }),
      item({ id: 'named', ingredient: { name: 'bbb', isPantryStaple: false } }),
    ];
    // Empty name sorts first inside the non-staple group; the staple sinks last
    // despite its name sorting earliest.
    expect(ids(sortListItems(rows))).toEqual(['absent', 'nullish', 'named', 'staple']);
  });

  test('groups staples last across categories rather than filtering them out', () => {
    const rows = [
      item({ id: 'staple-condiment', category: 'condiment', ingredient: { name: 'oil', isPantryStaple: true } }),
      item({ id: 'plain-produce', category: 'produce', ingredient: { name: 'leek', isPantryStaple: false } }),
    ];
    // condiment < produce alphabetically, but staple-ness dominates.
    expect(ids(sortListItems(rows))).toEqual(['plain-produce', 'staple-condiment']);
  });

  test('does not mutate the input array', () => {
    const rows = [item({ id: 'z' }), item({ id: 'a' })];
    const before = ids(rows);
    sortListItems(rows);
    expect(ids(rows)).toEqual(before);
  });
});
