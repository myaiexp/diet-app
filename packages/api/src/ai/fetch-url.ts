// SSRF-safe URL fetch + HTML→plain-text strip for recipe import
//
// Residual risk: after block-on-resolve we fetch by hostname, so undici may
// re-resolve at connect time (DNS-rebinding TOCTOU). Pinning the TCP connect to
// the resolved address (Host/SNI = original name) needs a custom agent and is
// left as a follow-up; literals + DNS answers are still blocked aggressively.

import { lookup as defaultDnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  isBlockedAddress,
  isBlockedHostname,
  normalizeHostname,
} from './ssrf-host.js';

import { IMPORT_TEXT_MAX_CHARS } from './import-limits.js';
import { describeError, logImportFailure } from './log.js';

export { IMPORT_TEXT_MAX_CHARS };

export type FetchUrlResult =
  | { ok: true; text: string; finalUrl: string; truncated: boolean }
  | { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' };

/** Injectable DNS (tests mock this — production uses node:dns/promises.lookup). */
export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export type FetchUrlOpts = {
  fetchImpl?: typeof fetch;
  dnsLookup?: DnsLookupFn;
  timeoutMs?: number;
  maxBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_500_000; // ~1.5 MiB
const MAX_REDIRECTS = 5;
const TRUNCATION_MARKER = '\n\n[truncated]';
const OK_STATUSES = new Set([200, 203]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function abortedError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

/** Race a promise against AbortSignal so DNS shares the overall timeout. */
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

type SafeOk = { ok: true; url: URL };
type SafeErr = { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' };

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

  const host = normalizeHostname(url.hostname);
  if (!host) return { ok: false, error: 'invalid_url' };
  if (isBlockedHostname(host)) return { ok: false, error: 'blocked_url' };
  if (isIP(host)) return { ok: true, url };

  try {
    const answers = await withSignal(
      dnsLookup(host, { all: true, verbatim: true }),
      signal,
    );
    if (answers.length === 0) return { ok: false, error: 'blocked_url' };
    for (const a of answers) {
      if (isBlockedAddress(a.address)) return { ok: false, error: 'blocked_url' };
    }
  } catch (err) {
    // DNS failure and the shared-timeout abort both land here and both flatten
    // to fetch_failed — indistinguishable from a transport error without this.
    logImportFailure('dns lookup failed', err, { host });
    return { ok: false, error: 'fetch_failed' };
  }

  return { ok: true, url };
}

/** Strip scripts/styles/tags and collapse whitespace — no browser. */
export function htmlToPlainText(html: string): string {
  let s = html;
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ');
  s = s.replace(/&amp;/gi, '&');
  s = s.replace(/&lt;/gi, '<');
  s = s.replace(/&gt;/gi, '>');
  s = s.replace(/&quot;/gi, '"');
  s = s.replace(/&#39;|&apos;/gi, "'");
  s = s.replace(/&#(\d+);/g, (_, n: string) => {
    const code = Number(n);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : ' ';
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
    const code = parseInt(h, 16);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : ' ';
  });
  return s.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= IMPORT_TEXT_MAX_CHARS) return { text, truncated: false };
  const budget = Math.max(0, IMPORT_TEXT_MAX_CHARS - TRUNCATION_MARKER.length);
  return { text: text.slice(0, budget) + TRUNCATION_MARKER, truncated: true };
}

/** Drop an unread body so undici can release the socket. Cancel errors are noise. */
async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * Read body with a hard byte ceiling. Content-Length pre-check + stream cancel
 * if the running total exceeds maxBytes (never buffers a multi-GB body).
 */
async function readBodyCapped(
  res: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const cl = res.headers.get('content-length');
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) {
      await cancelBody(res);
      return { ok: false, reason: `content-length ${n} exceeds cap ${maxBytes}` };
    }
  }

  if (!res.body) {
    try {
      const t = await res.text();
      if (new TextEncoder().encode(t).byteLength > maxBytes) {
        return { ok: false, reason: `body exceeds cap ${maxBytes}` };
      }
      return { ok: true, text: t };
    } catch (err) {
      return { ok: false, reason: describeError(err) };
    }
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'aborted mid-body (timeout)' };
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: `body exceeds cap ${maxBytes}` };
      }
      chunks.push(value);
    }
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, text: new TextDecoder('utf-8', { fatal: false }).decode(out) };
}

const defaultLookup: DnsLookupFn = (hostname, options) =>
  defaultDnsLookup(hostname, options);

export async function fetchUrlAsText(
  url: string,
  opts?: FetchUrlOpts,
): Promise<FetchUrlResult> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const dnsLookup = opts?.dnsLookup ?? defaultLookup;
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

      let res: Response;
      try {
        res = await fetchImpl(safe.url.href, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.1',
            'User-Agent': 'diet-app-import/1.0',
          },
        });
      } catch (err) {
        logImportFailure('transport error', err, { url: safe.url.href, hop });
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
    }

    // Unreachable: the hop === MAX_REDIRECTS branch returns first. Logged so a
    // future edit to the loop bounds can't create a silent failure here.
    logImportFailure('redirect loop exhausted', undefined, { url });
    return { ok: false, error: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}
