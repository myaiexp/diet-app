// Zod schemas for recipe POST/PATCH bodies and ingredient lines

import { z } from 'zod';
import { isUuid } from '../validation.js';
import {
  LIMITS,
  shortText,
  optionalShort,
  unitText,
  tagsField,
  stepsField,
  noteText,
  httpUrl,
  servingsInt,
} from './fields.js';

const uuidField = z.string().refine(isUuid, { message: 'Invalid UUID' });

const sourceTypeEnum = z.enum(['manual', 'imported', 'ai', 'forked']);

export const recipeIngredientLineSchema = z.object({
  ingredientId: uuidField,
  quantity: z.coerce.number().positive(),
  unit: unitText,
  optional: z.boolean().optional(),
  notes: noteText.nullable().optional(),
});

export const recipeCreateSchema = z.object({
  title: shortText,
  sourceType: sourceTypeEnum.optional(),
  sourceUrl: httpUrl.nullable().optional(),
  parentRecipeId: uuidField.nullable().optional(),
  steps: stepsField.optional(),
  prepTime: z.number().int().nonnegative().optional(),
  totalTime: z.number().int().nonnegative().optional(),
  servings: servingsInt.optional(),
  effortScore: z.number().int().min(1).max(5).optional(),
  tags: tagsField.optional(),
  cuisineType: optionalShort.nullable().optional(),
  ingredients: z.array(recipeIngredientLineSchema).min(1).max(LIMITS.lines),
});

export const recipePatchSchema = z
  .object({
    title: shortText.optional(),
    sourceType: sourceTypeEnum.optional(),
    sourceUrl: httpUrl.nullable().optional(),
    parentRecipeId: uuidField.nullable().optional(),
    steps: stepsField.optional(),
    prepTime: z.number().int().nonnegative().optional(),
    totalTime: z.number().int().nonnegative().optional(),
    servings: servingsInt.optional(),
    effortScore: z.number().int().min(1).max(5).optional(),
    tags: tagsField.optional(),
    cuisineType: optionalShort.nullable().optional(),
    ingredients: z.array(recipeIngredientLineSchema).min(1).max(LIMITS.lines).optional(),
  })
  .strict();

/**
 * POST /recipes/:id/fork — everything else is copied from the source, so the
 * only input is an optional rename. Strict so a client that expects the fork to
 * also apply `servings` or `tags` gets a 400 instead of a silent no-op; the
 * body may be omitted entirely.
 */
export const recipeForkSchema = z.object({ title: shortText.optional() }).strict();

export type RecipeCreate = z.infer<typeof recipeCreateSchema>;
export type RecipePatch = z.infer<typeof recipePatchSchema>;
export type RecipeIngredientLine = z.infer<typeof recipeIngredientLineSchema>;
