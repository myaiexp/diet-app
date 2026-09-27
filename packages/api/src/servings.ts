// Servings domain rule: a meal is a whole number of servings, 1–12

/** Integer 1–12 — same cap the cook modal and recipe scaler use. */
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 12;

/** Parse a servings write/query value. Null when missing, fractional, or out of range. */
export function parseServings(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < MIN_SERVINGS || n > MAX_SERVINGS) return null;
  return n;
}
