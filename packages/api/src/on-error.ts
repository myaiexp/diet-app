// App-level error handler: unhandled throws become a logged JSON 500
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describeError } from './describe-error.js';

/**
 * Hono's default answers an unhandled throw with a text/plain
 * `Internal Server Error` and prints a bare stack, with nothing tying it to
 * the request. Here the first log line names method, path and the error with
 * its `cause` (Drizzle puts the driver error there), so a user report of "cook
 * failed" maps to one greppable entry; the stack follows. The client gets the same
 * `{ error }` envelope as every deliberate 4xx. The error text stays out of
 * the response: a driver message can carry SQL, parameters or a connection
 * string.
 */
export function onError(err: Error, c: Context): Response {
  if (err instanceof HTTPException) {
    // An exception built with its own response (bodyLimit's path does this
    // when no onError is passed) already says what it means.
    if (err.res) return err.res;
    if (err.status >= 500) logUnhandled(err, c);
    return c.json({ error: err.message || 'Request failed' }, err.status);
  }
  logUnhandled(err, c);
  return c.json({ error: 'Internal server error' }, 500);
}

function logUnhandled(err: Error, c: Context): void {
  console.error(
    `[api] unhandled error on ${c.req.method} ${c.req.path}: ${describeError(err)}`,
    err.stack,
  );
}
