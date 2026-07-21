// Structured recipe extraction from free text via OpenAI-compatible chat API

import type OpenAI from 'openai';
import { z } from 'zod';

export type ExtractedRecipe = {
  title: string;
  steps: string[];
  servings?: number;
  prepTime?: number | null;
  totalTime?: number | null;
  cuisineType?: string | null;
  tags?: string[];
  effortScore?: number | null;
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
    optional?: boolean;
    notes?: string | null;
  }>;
};

const extractedIngredientSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
  optional: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const extractedRecipeSchema = z.object({
  title: z.string().trim().min(1),
  steps: z.array(z.string()).optional(),
  servings: z.coerce.number().int().positive().optional(),
  prepTime: z.coerce.number().int().nonnegative().nullable().optional(),
  totalTime: z.coerce.number().int().nonnegative().nullable().optional(),
  cuisineType: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  effortScore: z.coerce.number().int().min(1).max(5).nullable().optional(),
  ingredients: z.array(extractedIngredientSchema).min(1),
});

const SYSTEM_PROMPT = `You extract a single cooking recipe from the user's text.
Return JSON only (no markdown fences, no commentary) with this shape:
{
  "title": string (required, non-empty),
  "steps": string[] (ordered instructions),
  "servings": positive integer,
  "prepTime": integer minutes or null,
  "totalTime": integer minutes or null,
  "cuisineType": string or null,
  "tags": string[],
  "effortScore": integer 1-5 or null,
  "ingredients": [
    {
      "name": string (food name only, required),
      "quantity": positive number,
      "unit": string (e.g. g, ml, kpl, tbsp),
      "optional": boolean,
      "notes": string or null
    }
  ]
}
Require at least one ingredient. Prefer SI / metric units when clear. Do not invent ingredient catalog IDs.`;

/** Strip optional ``` / ```json fences some models wrap around JSON. */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '');
    s = s.replace(/\s*```\s*$/, '');
  }
  return s.trim();
}

function toExtractedRecipe(
  parsed: z.infer<typeof extractedRecipeSchema>,
): ExtractedRecipe {
  const recipe: ExtractedRecipe = {
    title: parsed.title,
    steps: parsed.steps ?? [],
    ingredients: parsed.ingredients.map((ing) => {
      const line: ExtractedRecipe['ingredients'][number] = {
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
      };
      if (ing.optional !== undefined) line.optional = ing.optional;
      if (ing.notes !== undefined) line.notes = ing.notes;
      return line;
    }),
  };
  if (parsed.servings !== undefined) recipe.servings = parsed.servings;
  if (parsed.prepTime !== undefined) recipe.prepTime = parsed.prepTime;
  if (parsed.totalTime !== undefined) recipe.totalTime = parsed.totalTime;
  if (parsed.cuisineType !== undefined) recipe.cuisineType = parsed.cuisineType;
  if (parsed.tags !== undefined) recipe.tags = parsed.tags;
  if (parsed.effortScore !== undefined) recipe.effortScore = parsed.effortScore;
  return recipe;
}

/** Parse + Zod-validate model JSON into ExtractedRecipe. Exported for unit tests. */
export function parseExtractedRecipe(
  raw: string,
): { ok: true; recipe: ExtractedRecipe } | { ok: false } {
  let data: unknown;
  try {
    data = JSON.parse(stripJsonFences(raw));
  } catch {
    return { ok: false };
  }
  const parsed = extractedRecipeSchema.safeParse(data);
  if (!parsed.success) return { ok: false };
  return { ok: true, recipe: toExtractedRecipe(parsed.data) };
}

/**
 * Call the capable model to extract one recipe from free text.
 * Returns { ok: false } on network/API failure, empty content, or validation failure.
 */
export async function extractRecipeFromText(
  client: OpenAI,
  model: string,
  text: string,
): Promise<{ ok: true; recipe: ExtractedRecipe } | { ok: false }> {
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content || !content.trim()) return { ok: false };
    return parseExtractedRecipe(content);
  } catch {
    return { ok: false };
  }
}
