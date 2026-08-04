// Category → storage location mapping coverage (incl. every seeded category)

import { describe, test, expect } from 'vitest';
import { locationForCategory } from '../pantry-location.js';

// The complete category set in the seeded ingredient catalog. If the seed grows
// a ninth category this list must grow with it — an unmapped category silently
// files everything under 'pantry', which for a chilled item means an expiry
// date computed off the wrong shelf life.
const SEED_CATEGORIES = [
  'produce',
  'protein',
  'dairy',
  'grain',
  'spice',
  'condiment',
  'frozen',
  'other',
] as const;

describe('locationForCategory', () => {
  test('maps produce, dairy and protein to fridge', () => {
    expect(locationForCategory('produce')).toBe('fridge');
    expect(locationForCategory('dairy')).toBe('fridge');
    expect(locationForCategory('protein')).toBe('fridge');
  });

  test('maps frozen to freezer', () => {
    expect(locationForCategory('frozen')).toBe('freezer');
  });

  test('maps grain, spice, condiment and other to pantry', () => {
    expect(locationForCategory('grain')).toBe('pantry');
    expect(locationForCategory('spice')).toBe('pantry');
    expect(locationForCategory('condiment')).toBe('pantry');
    expect(locationForCategory('other')).toBe('pantry');
  });

  test('falls back to pantry for an unknown category', () => {
    expect(locationForCategory('nonesuch')).toBe('pantry');
    expect(locationForCategory('')).toBe('pantry');
  });

  test('covers every category present in the seed data', () => {
    const valid = new Set(['fridge', 'freezer', 'pantry', 'counter']);
    for (const category of SEED_CATEGORIES) {
      // Must be a location POST /pantry would accept — /complete inserts it.
      expect(valid.has(locationForCategory(category)), category).toBe(true);
    }
  });
});
