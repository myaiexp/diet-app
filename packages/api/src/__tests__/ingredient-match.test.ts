// Unit tests for pure matchIngredientName

import { describe, test, expect } from 'vitest';
import { matchIngredientName, type IngredientCandidate } from '../ingredient-match.js';

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
    expect(m).toEqual({ rawName: 'EGG', ingredientId: 'id-egg', match: 'exact' });
  });

  test('alias match when name misses', () => {
    const m = matchIngredientName('kananmuna', CANDIDATES);
    expect(m.match).toBe('alias');
    expect(m.ingredientId).toBe('id-egg');
  });

  test('name exact preferred over alias on another row', () => {
    const candidates: IngredientCandidate[] = [
      { id: 'id-a', name: 'Sea salt blend', aliases: ['salt'] },
      { id: 'id-b', name: 'Salt', aliases: null },
    ];
    const m = matchIngredientName('salt', candidates);
    expect(m).toEqual({ rawName: 'salt', ingredientId: 'id-b', match: 'exact' });
  });

  test('none when no match', () => {
    const m = matchIngredientName('unicorn dust', CANDIDATES);
    expect(m).toEqual({
      rawName: 'unicorn dust',
      ingredientId: null,
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
