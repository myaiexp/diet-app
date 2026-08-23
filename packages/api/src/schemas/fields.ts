// Shared write-body field limits (strings, arrays, URLs, servings 1–12)

import { z } from 'zod';
import { MAX_SERVINGS } from '../validation.js';

// Caps sit well under the 1 MiB router bodyLimit (and nginx's 2M) so an
// authenticated client cannot persist multi-megabyte text/JSONB. Numbers are
// the contract the limit tests hardcode — raise one, update the matching test.
export const LIMITS = {
  /** Recipe title, cuisine, extracted ingredient name. */
  short: 200,
  /** Profile display name. */
  name: 100,
  unit: 32,
  tag: 50,
  tags: 40,
  step: 4_000,
  steps: 80,
  note: 4_000,
  url: 2_048,
  /** Dietary restriction / kitchen-equipment chip. */
  chip: 80,
  chips: 50,
  /** Recipe ingredient lines. */
  lines: 80,
  /** UUID arrays (disliked ids) and complete-overrides. */
  ids: 200,
  scheduleNote: 500,
  macroGrams: 10_000,
  /** Meal-plan writes, cook-preview, recipe GET ?servings=, and recipe writes. */
  servings: MAX_SERVINGS,
} as const;

/** Meal-plan servings (JSON may send a numeric string). */
export const servingsCoerced = z.coerce.number().int().min(1).max(LIMITS.servings);
/** Recipe servings — JSON number, same 1–12 cap as the UI scaler. */
export const servingsInt = z.number().int().min(1).max(LIMITS.servings);

export const shortText = z.string().trim().min(1).max(LIMITS.short);
export const optionalShort = z.string().trim().max(LIMITS.short);
export const nameText = z.string().trim().min(1).max(LIMITS.name);
export const unitText = z.string().trim().min(1).max(LIMITS.unit);
export const tagText = z.string().trim().min(1).max(LIMITS.tag);
export const tagsField = z.array(tagText).max(LIMITS.tags);
export const stepText = z.string().trim().min(1).max(LIMITS.step);
export const stepsField = z.array(stepText).max(LIMITS.steps);
export const noteText = z.string().max(LIMITS.note);
export const trimmedNote = z.string().trim().min(1).max(LIMITS.note);
export const chipText = z.string().trim().min(1).max(LIMITS.chip);
export const chipsField = z.array(chipText).max(LIMITS.chips);

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Protocol-only: IP literals must still parse so recipe-import SSRF can reject
// them. z.httpUrl() also requires a domain hostname and would 400 those first.
export const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.url)
  .refine(isHttpUrl, 'Must be an http(s) URL');

const macroGrams = z.number().finite().nonnegative().max(LIMITS.macroGrams);

/** Known keys the profile UI writes; extra keys are stripped, not persisted. */
export const macroTargetsSchema = z.object({
  protein: macroGrams.optional(),
  carbs: macroGrams.optional(),
  fat: macroGrams.optional(),
});

export const scheduleProfileSchema = z.object({
  note: z.string().trim().max(LIMITS.scheduleNote).optional(),
});
