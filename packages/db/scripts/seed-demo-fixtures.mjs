// Demo fixture data: the pantry and the seed meal-plan week.
// Transcribed from docs/plans/assets/ruoka-prototype.dc.html (PANTRY) and
// docs/plans/2026-08-04-frontend-design.md section 5 (the week, which the
// prototype renders but does not carry as data). Recipes live in
// seed-demo-recipes.mjs; see seed-demo-lib.mjs for the catalog-name
// resolution table these names were written against.

// ---------------------------------------------------------------------------
// Fixture data, transcribed from docs/plans/assets/ruoka-prototype.dc.html's
// PANTRY/RECIPES arrays (see the resolution table above for name changes).

// Days-to-expiry (`dayOffset`) and days-since-added (`addedOffset`) are both
// offsets from "today", derived once from the prototype's own absolute dates
// (its implicit "today" was 2026-08-04) so the ramp — and the gap between
// added and expires — reproduces the original design at any run date.
export const PANTRY_FIXTURE = [
  { name: 'Fresh dill', qty: 20, unit: 'g', location: 'fridge', dayOffset: -1, addedOffset: -9, opened: false },
  { name: 'Salmon', qty: 400, unit: 'g', location: 'fridge', dayOffset: 0, addedOffset: -2, opened: false },
  { name: 'Quark', qty: 500, unit: 'g', location: 'fridge', dayOffset: 1, addedOffset: -5, opened: true },
  { name: 'Milk', qty: 1, unit: 'l', location: 'fridge', dayOffset: 2, addedOffset: -3, opened: true },
  { name: 'Spinach', qty: 200, unit: 'g', location: 'fridge', dayOffset: 2, addedOffset: -3, opened: false },
  { name: 'Chicken thigh', qty: 600, unit: 'g', location: 'fridge', dayOffset: 3, addedOffset: -2, opened: false },
  { name: 'Rye bread', qty: 6, unit: 'pcs', location: 'counter', dayOffset: 4, addedOffset: -3, opened: false },
  { name: 'Sour cream', qty: 200, unit: 'ml', location: 'fridge', dayOffset: 5, addedOffset: -7, opened: false },
  { name: 'Carrot', qty: 700, unit: 'g', location: 'fridge', dayOffset: 12, addedOffset: -8, opened: false },
  { name: 'Swiss cheese', qty: 400, unit: 'g', location: 'fridge', dayOffset: 14, addedOffset: -8, opened: false },
  { name: 'Potato', qty: 2, unit: 'kg', location: 'pantry', dayOffset: 21, addedOffset: -15, opened: false },
  { name: 'Butter', qty: 250, unit: 'g', location: 'fridge', dayOffset: 30, addedOffset: -13, opened: true },
  { name: 'Onion', qty: 1, unit: 'kg', location: 'pantry', dayOffset: 34, addedOffset: -15, opened: false },
  { name: 'Barley', qty: 900, unit: 'g', location: 'pantry', dayOffset: 210, addedOffset: -62, opened: false },
  { name: 'Lingonberry', qty: 300, unit: 'g', location: 'freezer', dayOffset: 240, addedOffset: -326, opened: false },
];

export const WEEK_TEMPLATE = [
  {
    offset: 0, // monday
    slots: {
      breakfast: { title: 'Rahka & puolukka bowl', status: 'cooked', servings: 1 },
      lunch: { freeformNote: 'Työlounas — canteen', status: 'planned', servings: 1 },
      dinner: { title: 'Karjalanpaisti', status: 'cooked', servings: 6 },
      snack: null,
    },
  },
  {
    offset: 1, // tuesday
    slots: {
      breakfast: { title: 'Rahka & puolukka bowl', status: 'cooked', servings: 1 },
      lunch: { title: 'Ruisleipä & graavilohi', status: 'cooked', servings: 2 },
      dinner: { title: 'Lohikeitto', status: 'planned', servings: 4 },
      snack: null,
    },
  },
  {
    offset: 2, // wednesday
    slots: {
      breakfast: { title: 'Rahka & puolukka bowl', status: 'planned', servings: 1 },
      lunch: { title: 'Karjalanpaisti', status: 'planned', servings: 2, notes: 'leftovers' },
      dinner: { title: 'Pinaattiletut', status: 'planned', servings: 3 },
      snack: null,
    },
  },
  {
    offset: 3, // thursday
    slots: {
      breakfast: { title: 'Rahka & puolukka bowl', status: 'planned', servings: 1 },
      lunch: null,
      dinner: { title: 'Uunilohi & juurekset', status: 'skipped', servings: 4 },
      snack: null,
    },
  },
  {
    offset: 4, // friday
    slots: {
      breakfast: null,
      lunch: { title: 'Ohrarisotto metsäsienillä', status: 'planned', servings: 4 },
      // "substituted": the design shows only the recipe actually used, not
      // what was originally planned, so recipeId is left null and the shown
      // recipe goes in substituteRecipeId — cook-plan.ts resolves the recipe
      // actually cooked as `substituteRecipeId ?? recipeId`, which is exactly
      // this cell's intent.
      dinner: { substituteTitle: 'Uunilohi & juurekset', status: 'substituted', servings: 4 },
      snack: { freeformNote: 'Rye bread & cheese', status: 'planned', servings: 1 },
    },
  },
  {
    offset: 5, // saturday
    slots: {
      breakfast: { title: 'Pinaattiletut', status: 'planned', servings: 3 },
      lunch: null,
      dinner: { title: 'Karjalanpaisti', status: 'planned', servings: 6 },
      snack: null,
    },
  },
  {
    offset: 6, // sunday — entirely empty, per the design
    slots: { breakfast: null, lunch: null, dinner: null, snack: null },
  },
];


// The design doc's section 7 profile. The singleton user_profile row already
// exists (seed-core.ts creates a "Default User" with no targets), so this is an
// update of that row, not an insert — which is also what makes it idempotent
// without needing an identity rule of its own.
//
// scheduleProfile is jsonb, so the design's free-text schedule line is stored
// under `note` — the shape the API's schema and the frontend both expect.
export const PROFILE_FIXTURE = {
  name: 'Mase',
  calorieTargetMin: 2100,
  calorieTargetMax: 2500,
  macroTargets: { protein: 130, carbs: 230, fat: 80 },
  dietaryRestrictions: ['no shellfish', 'low lactose'],
  cookingSkill: 'competent',
  kitchenEquipment: ['oven', 'hob 4', 'cast iron', 'blender'],
  householdSize: 2,
  scheduleProfile: { note: 'late shift tue+thu · long weekend cooking' },
  // Catalog lookup keys, resolved to ids against the real catalog at seed time
  // (the junction table stores ids, so an unmatched name must fail loudly like
  // every other fixture name rather than silently dropping a dislike).
  // 'Liver' is the design's word; the catalog models the cut, so 'Beef liver'
  // is the lookup key (same class of rename as the table in seed-demo-lib.mjs).
  dislikedIngredients: ['Coriander', 'Beef liver', 'Blue cheese', 'Olives'],
};
