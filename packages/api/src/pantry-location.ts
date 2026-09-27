// Ingredient category → default pantry storage location.
// The closed location set is LOCATIONS in vocab.ts: pantry create/patch and
// /complete overrides both validate against it, and locationForCategory
// returns a member of it so a generated insert cannot 400.

import type { StorageLocation } from './vocab.js';

// The eight categories the seed data uses. Anything else falls through to
// 'pantry' — the shelf-stable assumption, and the one location every
// ingredient's shelf-life JSON is most likely to carry.
const BY_CATEGORY: Record<string, StorageLocation> = {
  produce: 'fridge',
  dairy: 'fridge',
  protein: 'fridge',
  frozen: 'freezer',
  grain: 'pantry',
  spice: 'pantry',
  condiment: 'pantry',
  other: 'pantry',
};

export function locationForCategory(category: string): StorageLocation {
  return BY_CATEGORY[category] ?? 'pantry';
}
