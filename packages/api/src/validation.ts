// Route parameter validators (UUID, calendar dates, servings 1–12)

// Lenient RFC-4122-shaped UUID matcher: any 8-4-4-4-12 hex string, including the
// nil UUID. This matches exactly what PostgreSQL's `uuid` type accepts, so any
// value this rejects would otherwise trigger a Postgres "invalid input syntax
// for type uuid" error (surfacing as an HTTP 500) when passed into a query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// Strict YYYY-MM-DD calendar-date matcher.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validates a strict YYYY-MM-DD calendar date. Rejects malformed strings ("foo")
// and impossible-but-format-valid dates ("2026-02-30") — V8 rolls the latter
// over to a real date (Mar 02) rather than producing an Invalid Date, so a
// format regex alone is not enough. We re-serialize the parsed timestamp and
// require it to match the input, which catches rollovers and NaN alike. An
// unvalidated value would otherwise reach new Date(...).toISOString() downstream
// and throw RangeError: Invalid time value (an unformatted HTTP 500).
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === value;
}

/** Integer 1–12 — same cap the cook modal and recipe scaler use. */
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 12;

/** Parse a servings write/query value. Null when missing, fractional, or out of range. */
export function parseServings(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < MIN_SERVINGS || n > MAX_SERVINGS) return null;
  return n;
}
