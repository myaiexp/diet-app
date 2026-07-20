// Zod schemas for recipe POST/PATCH bodies and ingredient lines

import { z } from 'zod';
import { isUuid } from '../validation.js';

const uuidField = z.string().refine(isUuid, { message: 'Invalid UUID' });

const sourceTypeEnum = z.enum(['manual', 'imported', 'ai', 'forked']);

export const recipeIngredientLineSchema = z.object({
  ingredientId: uuidField,
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
  optional: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export const recipeCreateSchema = z.object({
  title: z.string().trim().min(1),
  sourceType: sourceTypeEnum.optional(),
  sourceUrl: z.string().nullable().optional(),
  parentRecipeId: uuidField.nullable().optional(),
  steps: z.array(z.string()).optional(),
  prepTime: z.number().int().nonnegative().optional(),
  totalTime: z.number().int().nonnegative().optional(),
  servings: z.number().int().positive().optional(),
  effortScore: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
  cuisineType: z.string().nullable().optional(),
  ingredients: z.array(recipeIngredientLineSchema).min(1),
});

export const recipePatchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    sourceType: sourceTypeEnum.optional(),
    sourceUrl: z.string().nullable().optional(),
    parentRecipeId: uuidField.nullable().optional(),
    steps: z.array(z.string()).optional(),
    prepTime: z.number().int().nonnegative().optional(),
    totalTime: z.number().int().nonnegative().optional(),
    servings: z.number().int().positive().optional(),
    effortScore: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    cuisineType: z.string().nullable().optional(),
    ingredients: z.array(recipeIngredientLineSchema).min(1).optional(),
  })
  .strict();

export type RecipeCreate = z.infer<typeof recipeCreateSchema>;
export type RecipePatch = z.infer<typeof recipePatchSchema>;
export type RecipeIngredientLine = z.infer<typeof recipeIngredientLineSchema>;
