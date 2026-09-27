// Servings domain rule: a meal is a whole number of servings, 1–12

import { MIN_SERVINGS, MAX_SERVINGS } from './vocab.js';

// The cap itself lives in vocab.ts, which the web client imports too.
export { MIN_SERVINGS, MAX_SERVINGS };

/** Parse a servings write/query value. Null when missing, fractional, or out of range. */
export function parseServings(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < MIN_SERVINGS || n > MAX_SERVINGS) return null;
  return n;
}
