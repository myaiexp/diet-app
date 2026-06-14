// Route parameter validators (UUID format, etc.)

// Lenient RFC-4122-shaped UUID matcher: any 8-4-4-4-12 hex string, including the
// nil UUID. This matches exactly what PostgreSQL's `uuid` type accepts, so any
// value this rejects would otherwise trigger a Postgres "invalid input syntax
// for type uuid" error (surfacing as an HTTP 500) when passed into a query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
