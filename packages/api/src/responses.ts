// Shared HTTP JSON response helpers for route handlers
import type { Context } from 'hono';

// Standard 404 body for GET-by-id misses. Centralizes the error shape so a
// future change (e.g. adding a `code` field) lands here once instead of in
// every route's inline `c.json({ error: 'Not found' }, 404)`.
export function notFound(c: Context) {
  return c.json({ error: 'Not found' }, 404);
}
