// Bearer-token auth middleware: gates the API behind a single shared secret
import type { MiddlewareHandler } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';

// SHA-256 the input so the timing-safe compare always sees equal-length buffers
// (timingSafeEqual throws on length mismatch) and the secret's length never
// leaks through an early return.
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

// Require `Authorization: Bearer <token>` on every request. Single-user app, so
// the token is one shared secret. Mount this AFTER any public routes (e.g.
// /api/health) so they bypass it; routes registered after it are protected.
export function bearerAuth(token: string): MiddlewareHandler {
  const expected = `Bearer ${token}`;
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header || !constantTimeEquals(header, expected)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  };
}
