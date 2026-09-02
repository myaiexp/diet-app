// Reads and Zod-validates JSON write bodies (bad JSON / schema / empty patch → 400)

import type { Context } from 'hono';
import { z, type ZodType } from 'zod';
import { badRequest } from './responses.js';

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: Response };

// Private: 'Invalid JSON body' and 'Validation failed' are two halves of one
// contract, so routes only ever see the folded parseJsonBody below.
// Content-Type is gated by csrfGuard, not here: c.req.json() ignores it.
async function readJsonBody(
  c: Context,
  allowEmptyBody: boolean,
): Promise<BodyResult<unknown>> {
  if (allowEmptyBody) {
    // c.req.json() throws on a zero-length body, which for these routes is the
    // normal call. Read the text so an absent body and `{}` take the same path
    // and a malformed one still 400s. csrfGuard already required the JSON
    // Content-Type, so an empty body here is deliberate, not a form post.
    const raw = await c.req.text();
    if (raw.trim() === '') return { ok: true, data: {} };
    try {
      return { ok: true, data: JSON.parse(raw) };
    } catch {
      return { ok: false, response: badRequest(c, 'Invalid JSON body') };
    }
  }
  try {
    return { ok: true, data: await c.req.json() };
  } catch {
    return { ok: false, response: badRequest(c, 'Invalid JSON body') };
  }
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length === 0;
}

export type ParseJsonBodyOpts = {
  /** PATCH bodies: reject `{}` — a patch with nothing to write is a client bug. */
  requireNonEmpty?: boolean;
  /**
   * Routes whose whole body is optional (POST /recipes/:id/fork, POST
   * /meal-plans/:id/cook): an absent or blank body validates as `{}` instead of
   * 400-ing as invalid JSON.
   */
  allowEmptyBody?: boolean;
};

/**
 * Reads the request body as JSON and validates it against `schema`, returning
 * either the parsed data or the 400 response to hand straight back:
 *
 *   const parsed = await parseJsonBody(c, recipePatchSchema, { requireNonEmpty: true });
 *   if (!parsed.ok) return parsed.response;
 */
export async function parseJsonBody<S extends ZodType>(
  c: Context,
  schema: S,
  opts: ParseJsonBodyOpts = {},
): Promise<BodyResult<z.output<S>>> {
  const body = await readJsonBody(c, opts.allowEmptyBody ?? false);
  if (!body.ok) return body;

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return {
      ok: false,
      response: badRequest(c, 'Validation failed', z.flattenError(parsed.error)),
    };
  }

  if (opts.requireNonEmpty && isEmptyObject(parsed.data)) {
    return {
      ok: false,
      response: badRequest(c, 'Validation failed', { formErrors: ['Empty patch body'] }),
    };
  }

  return { ok: true, data: parsed.data };
}
