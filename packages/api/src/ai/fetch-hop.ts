// One pinned request of the recipe-import fetch, classified by status

import { isIP } from 'node:net';
import { normalizeHostname } from './ssrf-host.js';
import type {
  CreateDispatcherFn,
  ImportDispatcher,
  ResolvedAddress,
} from './ssrf-pin.js';
import { cancelBody, readBodyCapped } from './fetch-body.js';
import { logImportFailure } from './log.js';
import { withSignal } from './with-signal.js';

export type FetchImpl = (
  input: string,
  init?: RequestInit & { dispatcher?: ImportDispatcher },
) => Promise<Response>;

export type HopContext = {
  fetchImpl: FetchImpl;
  createDispatcher: CreateDispatcherFn;
  signal: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
};

/**
 * What one request answered. `body` is the raw text of a 200/203; `redirect`
 * carries the resolved Location, still unvetted — the caller re-runs the SSRF
 * checks on it before the next hop.
 */
export type HopOutcome =
  | { kind: 'redirect'; next: string }
  | { kind: 'body'; text: string }
  | { kind: 'fail'; error: 'invalid_url' | 'fetch_failed' };

const FETCH_FAILED: HopOutcome = { kind: 'fail', error: 'fetch_failed' };
// Only success statuses that carry a body we want to parse (not 204/304).
const OK_STATUSES = new Set([200, 203]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function closeDispatcher(dispatcher: ImportDispatcher | undefined): Promise<void> {
  if (!dispatcher) return;
  try {
    await dispatcher.close();
  } catch {
    /* ignore */
  }
}

/** The request itself; a transport error or timeout is logged and answers null. */
async function request(
  url: URL,
  dispatcher: ImportDispatcher | undefined,
  hop: number,
  ctx: HopContext,
): Promise<Response | null> {
  try {
    return await withSignal(
      ctx.fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal: ctx.signal,
        dispatcher,
        headers: {
          Accept: 'text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.1',
          'User-Agent': 'diet-app-import/1.0',
        },
      }),
      ctx.signal,
    );
  } catch (err) {
    if (ctx.signal.aborted) {
      logImportFailure('timed out', err, { url: url.href, timeoutMs: ctx.timeoutMs, hop });
    } else {
      logImportFailure('transport error', err, { url: url.href, hop });
    }
    return null;
  }
}

function resolveRedirect(res: Response, from: URL): HopOutcome {
  const location = res.headers.get('location');
  if (!location) {
    logImportFailure('redirect without location header', undefined, {
      url: from.href,
      status: res.status,
    });
    return FETCH_FAILED;
  }
  try {
    return { kind: 'redirect', next: new URL(location, from).href };
  } catch (err) {
    logImportFailure('redirect location unparseable', err, { url: from.href, location });
    return { kind: 'fail', error: 'invalid_url' };
  }
}

async function classify(res: Response, url: URL, ctx: HopContext): Promise<HopOutcome> {
  if (OK_STATUSES.has(res.status)) {
    const body = await readBodyCapped(res, ctx.maxBytes, ctx.signal);
    if (body.ok) return { kind: 'body', text: body.text };
    logImportFailure('body read failed', body.reason, { url: url.href });
    return FETCH_FAILED;
  }
  // Every other answer is discarded unread, redirects included — this one
  // cancel frees the connection on all of those paths.
  await cancelBody(res);
  if (REDIRECT_STATUSES.has(res.status)) return resolveRedirect(res, url);
  logImportFailure('non-success status', undefined, { url: url.href, status: res.status });
  return FETCH_FAILED;
}

/**
 * Fetch one already-vetted URL. Hostnames connect through a dispatcher pinned
 * to `addresses`; IP literals need no pin. The body is read before the
 * dispatcher closes, which is why this returns text rather than the Response.
 */
export async function fetchHop(
  url: URL,
  addresses: ResolvedAddress[],
  hop: number,
  ctx: HopContext,
): Promise<HopOutcome> {
  const host = normalizeHostname(url.hostname);
  const dispatcher = isIP(host) === 0 ? ctx.createDispatcher(host, addresses) : undefined;
  try {
    const res = await request(url, dispatcher, hop, ctx);
    return res ? await classify(res, url, ctx) : FETCH_FAILED;
  } finally {
    await closeDispatcher(dispatcher);
  }
}
