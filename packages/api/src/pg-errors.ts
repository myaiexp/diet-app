// Postgres error code helpers (FK / unique violations)

// Drizzle wraps every driver error in a DrizzleQueryError carrying the real
// one on `.cause` — so a route catching a live constraint violation sees a
// wrapper with no `code` of its own, and a one-level check returns false and
// lets the error fall through to Hono's onError as a 500. That is exactly what
// happened: the mock suites throw an unwrapped driver error, so five route
// modules' 400/409 mapping looked covered while every real violation 500'd.
// Walk the chain instead. The depth cap is a cycle guard, not a real limit —
// nothing nests errors this deep.
const MAX_CAUSE_DEPTH = 5;

function pgCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== 'object' || current === null) return undefined;
    // SQLSTATEs are strings; a numeric `code` is some other library's error.
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isFkViolation(err: unknown): boolean {
  return pgCode(err) === '23503';
}

export function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === '23505';
}
