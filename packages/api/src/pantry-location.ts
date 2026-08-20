// Ingredient category → default pantry storage location.
// Single source for the closed location set: pantry create/patch and
// /complete overrides both validate against this, and locationForCategory
// returns a member of it so a generated insert cannot 400.

export const LOCATIONS = ['fridge', 'freezer', 'pantry', 'counter'] as const;
export type StorageLocation = (typeof LOCATIONS)[number];

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
