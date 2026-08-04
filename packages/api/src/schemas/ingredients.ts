// Zod schema for the ingredient PATCH body

import { z } from 'zod';

// Deliberately one field. isPantryStaple is user-owned curation (the shopping
// list groups staples last rather than hiding them, so a wrong flag is one tap
// to fix). General catalog editing is idea #3231 and carries an unresolved
// seed-vs-user ownership question per column — widening this schema would ship
// that question unanswered, since the seed's conflict-update set still
// refreshes every other column on every re-seed.
export const ingredientPatchSchema = z
  .object({
    isPantryStaple: z.boolean().optional(),
  })
  .strict();

export type IngredientPatch = z.infer<typeof ingredientPatchSchema>;
