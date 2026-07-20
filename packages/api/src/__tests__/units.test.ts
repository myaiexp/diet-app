// Unit conversion table coverage

import { describe, test, expect } from 'vitest';
import { resolveUnit, toBase, fromBase } from '../units.js';

describe('units', () => {
  test('resolves mass units to grams', () => {
    expect(toBase(1, 'kg')).toEqual({ dimension: 'mass', value: 1000 });
    expect(toBase(500, 'g')).toEqual({ dimension: 'mass', value: 500 });
    expect(toBase(2500, 'mg')).toEqual({ dimension: 'mass', value: 2.5 });
  });

  test('resolves volume units to millilitres, including Finnish spoon units', () => {
    expect(toBase(1, 'l')).toEqual({ dimension: 'volume', value: 1000 });
    expect(toBase(2, 'dl')).toEqual({ dimension: 'volume', value: 200 });
    expect(toBase(1, 'rkl')).toEqual({ dimension: 'volume', value: 15 });
    expect(toBase(1, 'tl')).toEqual({ dimension: 'volume', value: 5 });
  });

  test('treats piece-like units as one count dimension', () => {
    for (const u of ['piece', 'pieces', 'pcs', 'kpl']) {
      expect(toBase(3, u)).toEqual({ dimension: 'count', value: 3 });
    }
  });

  test('is case-insensitive and trims whitespace', () => {
    expect(toBase(1, ' KG ')).toEqual({ dimension: 'mass', value: 1000 });
    expect(toBase(1, 'Dl')).toEqual({ dimension: 'volume', value: 100 });
  });

  test('returns null for unknown units rather than throwing', () => {
    for (const u of ['', 'handful', 'cup', 'oz', 'pinch']) {
      expect(toBase(1, u)).toBeNull();
      expect(fromBase(1, u)).toBeNull();
    }
  });

  test('fromBase inverts toBase', () => {
    expect(fromBase(1000, 'kg')).toBe(1);
    expect(fromBase(250, 'dl')).toBe(2.5);
    expect(fromBase(15, 'rkl')).toBe(1);
  });

  test('mass and volume never share a dimension', () => {
    expect(resolveUnit('g')!.dimension).not.toBe(resolveUnit('ml')!.dimension);
    expect(resolveUnit('kpl')!.dimension).not.toBe(resolveUnit('g')!.dimension);
  });
});
