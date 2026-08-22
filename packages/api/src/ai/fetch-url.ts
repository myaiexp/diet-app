// SSRF-safe URL fetch + HTML→plain-text strip for recipe import
//
// After the hostname/DNS blocklist, hostname fetches pin TCP connect to the
// addresses parseSafeUrl already allowed (undici Agent lookup). Host and TLS
// SNI stay on the original name. IP literals skip the agent (nothing to rebind).
// Only ports 80/443 are allowed.

import { lookup as defaultDnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  isBlockedAddress,
  isBlockedHostname,
  normalizeHostname,
} from './ssrf-host.js';
import {
  createPinnedDispatcher,
  isAllowedImportPort,
  type CreateDispatcherFn,
  type ImportDispatcher,
  type ResolvedAddress,
} from './ssrf-pin.js';
import {
  cancelBody,
  htmlToPlainText,
  readBodyCapped,
  truncateText,
} from './fetch-body.js';

import { IMPORT_TEXT_MAX_CHARS } from './import-limits.js';
import { logImportFailure } from './log.js';

export { IMPORT_TEXT_MAX_CHARS, htmlToPlainText };

export type FetchUrlResult =
  | { ok: true; text: string; finalUrl: string; truncated: boolean }
  | { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' };

/** Injectable DNS (tests mock this — production uses node:dns/promises.lookup). */
export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ReadonlyArray<ResolvedAddress>>;

export type FetchImpl = (
  input: string,
  init?: RequestInit & { dispatcher?: ImportDispatcher },
) => Promise<Response>;

export type FetchUrlOpts = {
  fetchImpl?: FetchImpl;
  dnsLookup?: DnsLookupFn;
  timeoutMs?: number;
  maxBytes?: number;
  createDispatcher?: CreateDispatcherFn;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_500_000; // ~1.5 MiB
const MAX_REDIRECTS = 5;
const OK_STATUSES = new Set([200, 203]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function abortedError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

/** Race a promise against AbortSignal so DNS and fetch share the overall timeout. */
function withSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

type SafeOk = { ok: true; url: URL; addresses: ResolvedAddress[] };
type SafeErr = { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' };

function ipAddresses(host: string): ResolvedAddress[] {
  const version = isIP(host);
  return [{ address: host, family: version === 6 ? 6 : 4 }];
}

async function parseSafeUrl(
  raw: string,
  dnsLookup: DnsLookupFn,
  signal: AbortSignal,
): Promise<SafeOk | SafeErr> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'invalid_url' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'invalid_url' };
  }
  if (!isAllowedImportPort(url)) return { ok: false, error: 'blocked_url' };

  const host = normalizeHostname(url.hostname);
  if (!host) return { ok: false, error: 'invalid_url' };
  if (isBlockedHostname(host)) return { ok: false, error: 'blocked_url' };
  if (isIP(host)) return { ok: true, url, addresses: ipAddresses(host) };

  try {
    const answers = await withSignal(
      dnsLookup(host, { all: true, verbatim: true }),
      signal,
    );
    if (answers.length === 0) return { ok: false, error: 'blocked_url' };
    for (const a of answers) {
      if (isBlockedAddress(a.address)) return { ok: false, error: 'blocked_url' };
    }
    return { ok: true, url, addresses: [...answers] };
  } catch (err) {
    // DNS failure and the shared-timeout abort both flatten to fetch_failed.
    if (signal.aborted) {
      logImportFailure('timed out', err, { host });
    } else {
      logImportFailure('dns lookup failed', err, { host });
    }
    return { ok: false, error: 'fetch_failed' };
  }
}

async function closeDispatcher(dispatcher: ImportDispatcher | undefined): Promise<void> {
  if (!dispatcher) return;
  try {
    await dispatcher.close();
  } catch {
    /* ignore */
  }
}

const defaultLookup: DnsLookupFn = (hostname, options) =>
  defaultDnsLookup(hostname, options);

export async function fetchUrlAsText(
  url: string,
  opts?: FetchUrlOpts,
): Promise<FetchUrlResult> {
  // Node's fetch is undici and honors `dispatcher` (the pin). Tests inject
  // fetchImpl and never hit this default.
  const fetchImpl = opts?.fetchImpl ?? (globalThis.fetch as FetchImpl);
  const dnsLookup = opts?.dnsLookup ?? defaultLookup;
  const createDispatcher = opts?.createDispatcher ?? createPinnedDispatcher;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

  if (typeof fetchImpl !== 'function') {
    logImportFailure('no fetch implementation available (node <18?)');
    return { ok: false, error: 'fetch_failed' };
  }

  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (controller.signal.aborted) {
        logImportFailure('timed out', undefined, { url: current, timeoutMs, hop });
        return { ok: false, error: 'fetch_failed' };
      }

      const safe = await parseSafeUrl(current, dnsLookup, controller.signal);
      if (!safe.ok) {
        // A rejected redirect target answers the same 400 as a bad user URL —
        // log it so "my URL was fine" and "the redirect went somewhere blocked"
        // are distinguishable. Hop 0 is the user's own input; no log needed.
        if (hop > 0) {
          logImportFailure('redirect target rejected', safe.error, { url: current, hop });
        }
        return safe;
      }

      const host = normalizeHostname(safe.url.hostname);
      const dispatcher =
        isIP(host) === 0 ? createDispatcher(host, safe.addresses) : undefined;

      try {
        let res: Response;
        try {
          res = await withSignal(
            fetchImpl(safe.url.href, {
              method: 'GET',
              redirect: 'manual',
              signal: controller.signal,
              dispatcher,
              headers: {
                Accept: 'text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.1',
                'User-Agent': 'diet-app-import/1.0',
              },
            }),
            controller.signal,
          );
        } catch (err) {
          if (controller.signal.aborted) {
            logImportFailure('timed out', err, {
              url: safe.url.href,
              timeoutMs,
              hop,
            });
          } else {
            logImportFailure('transport error', err, { url: safe.url.href, hop });
          }
          return { ok: false, error: 'fetch_failed' };
        }

        if (REDIRECT_STATUSES.has(res.status)) {
          if (hop === MAX_REDIRECTS) {
            logImportFailure('too many redirects', undefined, {
              url: safe.url.href,
              max: MAX_REDIRECTS,
            });
            await cancelBody(res);
            return { ok: false, error: 'fetch_failed' };
          }
          const location = res.headers.get('location');
          if (!location) {
            logImportFailure('redirect without location header', undefined, {
              url: safe.url.href,
              status: res.status,
            });
            await cancelBody(res);
            return { ok: false, error: 'fetch_failed' };
          }
          let next: URL;
          try {
            next = new URL(location, safe.url);
          } catch (err) {
            logImportFailure('redirect location unparseable', err, {
              url: safe.url.href,
              location,
            });
            await cancelBody(res);
            return { ok: false, error: 'invalid_url' };
          }
          await cancelBody(res);
          current = next.href;
          continue;
        }

        // Only success statuses that carry a body we want to parse (not 204/304).
        if (!OK_STATUSES.has(res.status)) {
          logImportFailure('non-success status', undefined, {
            url: safe.url.href,
            status: res.status,
          });
          await cancelBody(res);
          return { ok: false, error: 'fetch_failed' };
        }

        const body = await readBodyCapped(res, maxBytes, controller.signal);
        if (!body.ok) {
          logImportFailure('body read failed', body.reason, { url: safe.url.href });
          return { ok: false, error: 'fetch_failed' };
        }

        const plain = htmlToPlainText(body.text);
        const { text, truncated } = truncateText(plain);
        return { ok: true, text, finalUrl: safe.url.href, truncated };
      } finally {
        await closeDispatcher(dispatcher);
      }
    }

    // Unreachable: the hop === MAX_REDIRECTS branch returns first. Logged so a
    // future edit to the loop bounds can't create a silent failure here.
    logImportFailure('redirect loop exhausted', undefined, { url });
    return { ok: false, error: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}
