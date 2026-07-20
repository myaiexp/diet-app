// Shared HTTP JSON response helpers for route handlers
import type { Context } from 'hono';

// Standard 404 body for GET-by-id misses. Centralizes the error shape so a
// future change (e.g. adding a `code` field) lands here once instead of in
// every route's inline `c.json({ error: 'Not found' }, 404)`.
export function notFound(c: Context) {
  return c.json({ error: 'Not found' }, 404);
}

// 400 for validation / domain errors. `details` is optional (e.g. Zod flatten).
export function badRequest(c: Context, error: string, details?: unknown) {
  if (details === undefined) {
    return c.json({ error }, 400);
  }
  return c.json({ error, details }, 400);
}

// 409 for conflict guards (e.g. recipe referenced by meal plan / child forks).
export function conflict(c: Context, error: string) {
  return c.json({ error }, 409);
}
