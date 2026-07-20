// Safe JSON body reader for write routes (invalid/empty → 400)

import type { Context } from 'hono';
import { badRequest } from './responses.js';

export async function readJsonBody(
  c: Context,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  try {
    const data = await c.req.json();
    return { ok: true, data };
  } catch {
    return { ok: false, response: badRequest(c, 'Invalid JSON body') };
  }
}
