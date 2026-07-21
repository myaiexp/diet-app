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

/** Shared char budget for import model input (URL path truncates; paste path rejects). */
export const IMPORT_TEXT_MAX_CHARS = 100_000;

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

async function assertUrlSafe(
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
  } catch {
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

/**
 * Read body with a hard byte ceiling. Content-Length pre-check + stream cancel
 * if the running total exceeds maxBytes (never buffers a multi-GB body).
 */
async function readBodyCapped(
  res: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const cl = res.headers.get('content-length');
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { ok: false };
    }
  }

  if (!res.body) {
    try {
      const t = await res.text();
      if (new TextEncoder().encode(t).byteLength > maxBytes) return { ok: false };
      return { ok: true, text: t };
    } catch {
      return { ok: false };
    }
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false };
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
    return { ok: false, error: 'fetch_failed' };
  }

  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (controller.signal.aborted) return { ok: false, error: 'fetch_failed' };

      const safe = await assertUrlSafe(current, dnsLookup, controller.signal);
      if (!safe.ok) return safe;

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
      } catch {
        return { ok: false, error: 'fetch_failed' };
      }

      if (REDIRECT_STATUSES.has(res.status)) {
        if (hop === MAX_REDIRECTS) return { ok: false, error: 'fetch_failed' };
        const location = res.headers.get('location');
        if (!location) return { ok: false, error: 'fetch_failed' };
        let next: URL;
        try {
          next = new URL(location, safe.url);
        } catch {
          return { ok: false, error: 'invalid_url' };
        }
        current = next.href;
        continue;
      }

      // Only success statuses that carry a body we want to parse (not 204/304).
      if (!OK_STATUSES.has(res.status)) {
        return { ok: false, error: 'fetch_failed' };
      }

      const body = await readBodyCapped(res, maxBytes, controller.signal);
      if (!body.ok) return { ok: false, error: 'fetch_failed' };

      const plain = htmlToPlainText(body.text);
      const { text, truncated } = truncateText(plain);
      return { ok: true, text, finalUrl: safe.url.href, truncated };
    }

    return { ok: false, error: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}
