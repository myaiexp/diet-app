// SSRF-safe URL fetch + HTML→plain-text strip for recipe import
//
// After the hostname/DNS blocklist, hostname fetches pin TCP connect to the
// addresses parseSafeUrl already allowed (undici Agent lookup). Host and TLS
// SNI stay on the original name. IP literals skip the agent (nothing to rebind).
// Only ports 80/443 are allowed. This file owns the redirect loop and its
// SSRF re-check per hop; one request is fetchHop (fetch-hop.ts).

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
  type ResolvedAddress,
} from './ssrf-pin.js';
import { htmlToPlainText, truncateText } from './fetch-body.js';
import { fetchHop, type FetchImpl, type HopContext } from './fetch-hop.js';
import { IMPORT_TEXT_MAX_CHARS, IMPORT_TEXT_MIN_CHARS } from './import-limits.js';
import { logImportFailure } from './log.js';
import { withSignal } from './with-signal.js';

export { IMPORT_TEXT_MAX_CHARS, IMPORT_TEXT_MIN_CHARS, htmlToPlainText };
export type { FetchImpl };

export type FetchUrlResult =
  | {
      ok: true;
      text: string;
      finalUrl: string;
      truncated: boolean;
      /**
       * The page answered 200 but stripped to almost nothing — the signature of
       * a client-rendered page whose recipe never reached us. Not an error (the
       * extraction still runs), but the only evidence that this URL needs a
       * browser rather than a fetch.
       */
      lowYield: boolean;
    }
  | { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' };

/** Injectable DNS (tests mock this — production uses node:dns/promises.lookup). */
export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ReadonlyArray<ResolvedAddress>>;

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

/** An OK response's body as the extraction input: stripped, capped, and yield-checked. */
function toTextResult(html: string, finalUrl: string): FetchUrlResult {
  const { text, truncated } = truncateText(htmlToPlainText(html));
  // Nothing above this point fails for a JS-hydrated page: the server
  // answers 200 with a shell, the body reads fine, and the extraction
  // goes on to hallucinate from a nav bar. Logging it is what lets the
  // "does a headless-browser rung earn its keep?" question ever be
  // answered from evidence instead of a guess.
  const lowYield = text.length < IMPORT_TEXT_MIN_CHARS;
  if (lowYield) {
    logImportFailure('low-yield extraction', undefined, {
      url: finalUrl,
      chars: text.length,
      floor: IMPORT_TEXT_MIN_CHARS,
    });
  }
  return { ok: true, text, finalUrl, truncated, lowYield };
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
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof fetchImpl !== 'function') {
    logImportFailure('no fetch implementation available (node <18?)');
    return { ok: false, error: 'fetch_failed' };
  }

  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const ctx: HopContext = {
    fetchImpl,
    createDispatcher: opts?.createDispatcher ?? createPinnedDispatcher,
    signal: controller.signal,
    timeoutMs,
    maxBytes: opts?.maxBytes ?? DEFAULT_MAX_BYTES,
  };

  try {
    // Hop 0 is the user's URL; hops 1..MAX_REDIRECTS are redirects followed.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (controller.signal.aborted) {
        logImportFailure('timed out', undefined, { url: current, timeoutMs, hop });
        return { ok: false, error: 'fetch_failed' };
      }

      // Every hop, redirect targets included, passes the full SSRF check
      // and gets its own pin before anything connects.
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

      const outcome = await fetchHop(safe.url, safe.addresses, hop, ctx);
      if (outcome.kind === 'fail') return { ok: false, error: outcome.error };
      if (outcome.kind === 'body') return toTextResult(outcome.text, safe.url.href);
      current = outcome.next;
    }

    // The last allowed hop redirected too; `current` is the target not followed.
    logImportFailure('too many redirects', undefined, { url: current, max: MAX_REDIRECTS });
    return { ok: false, error: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}
