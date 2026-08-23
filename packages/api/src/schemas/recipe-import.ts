// Zod body for POST /recipes/import — XOR of url | text

import { z } from 'zod';
import { IMPORT_TEXT_MAX_CHARS } from '../ai/import-limits.js';
import { httpUrl } from './fields.js';

export const recipeImportBodySchema = z
  .object({
    url: httpUrl.optional(),
    text: z.string().trim().min(1).max(IMPORT_TEXT_MAX_CHARS).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const hasUrl = d.url !== undefined;
    const hasText = d.text !== undefined;
    if (hasUrl === hasText) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of url or text',
        path: hasUrl ? ['url'] : ['text'],
      });
    }
  });

export type RecipeImportBody = z.infer<typeof recipeImportBodySchema>;
