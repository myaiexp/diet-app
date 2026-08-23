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

// 401 for a missing/wrong bearer token (auth middleware). Deliberately says
// nothing about which half was wrong.
export function unauthorized(c: Context) {
  return c.json({ error: 'Unauthorized' }, 401);
}

// 403 from csrfGuard when Sec-Fetch-Site is present and not same-origin
// (same-site, cross-site, and none — missing header is the curl/cron exception)
// (and Origin is not in CORS_ORIGINS). Same envelope as central-hub logout.
export function forbidden(c: Context) {
  return c.json({ error: 'Forbidden' }, 403);
}

// 415 from csrfGuard: POST/PUT/PATCH must be application/json so a sibling
// origin cannot CORS-simple a text/plain or form body past empty CORS.
export function unsupportedMediaType(c: Context) {
  return c.json({ error: 'Content-Type must be application/json' }, 415);
}

// 409 for conflict guards (e.g. recipe referenced by meal plan / child forks).
export function conflict(c: Context, error: string) {
  return c.json({ error }, 409);
}

// 502 for upstream failures (URL fetch / AI extraction).
export function badGateway(c: Context, error: string) {
  return c.json({ error }, 502);
}

// 503 when an optional dependency is not configured (e.g. AI credentials).
export function serviceUnavailable(c: Context, error: string) {
  return c.json({ error }, 503);
}

// 413 from the router-level bodyLimit middleware. Without onError, Hono throws
// HTTPException with a plain-text body; this keeps the JSON `{ error }` envelope
// every other 4xx uses.
export function payloadTooLarge(c: Context) {
  return c.json({ error: 'Request body too large' }, 413);
}
