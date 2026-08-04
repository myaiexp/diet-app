// Ingredient category → default pantry storage location

// Must stay a subset of locationEnum in schemas/pantry.ts: /complete feeds this
// straight into a pantry_items insert, so a location POST /pantry would reject
// is a runtime failure rather than a type error.
export type StorageLocation = 'fridge' | 'freezer' | 'pantry' | 'counter';

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
