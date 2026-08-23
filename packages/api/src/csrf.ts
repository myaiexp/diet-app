// Reject sibling-origin CSRF on mutating /api/ requests
import type { MiddlewareHandler } from 'hono';
import { forbidden, unsupportedMediaType } from './responses.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false;
  return header.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

/**
 * Cookie SSO (`hub_session` on `.mase.fi`, SameSite=Lax) makes every sibling
 * origin same-site: the browser attaches the cookie, nginx injects the bearer.
 * Empty CORS stops the page *reading* the response, not the request executing.
 *
 * POST with text/plain (or no Content-Type, or a form) is CORS-simple, so a
 * page on prospect/wiki/sm can credentials-include a JSON body — or hit empty
 * POST /cook — without a preflight. Sec-Fetch-Site is a forbidden header, so
 * a browser cannot spoof `same-origin`. Missing is allowed for curl/cron.
 * Extra CORS origins (cross-site fetch) are allowed when Origin is listed.
 *
 * POST/PUT/PATCH always require application/json (media type before ';'),
 * including empty bodies: an HTML form POST to /cook has no JSON body and
 * would otherwise stay CORS-simple. DELETE is never a simple method.
 */
export function csrfGuard(corsOrigins: string[] = []): MiddlewareHandler {
  const allowed = new Set(corsOrigins);
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (!MUTATING.has(method)) {
      await next();
      return;
    }

    const site = c.req.header('sec-fetch-site')?.trim().toLowerCase();
    if (site && site !== 'same-origin') {
      const origin = c.req.header('origin');
      if (!origin || !allowed.has(origin)) {
        return forbidden(c);
      }
    }

    if (JSON_BODY_METHODS.has(method) && !isJsonContentType(c.req.header('content-type'))) {
      return unsupportedMediaType(c);
    }

    await next();
  };
}
