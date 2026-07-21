// SSRF-safe URL fetch + HTML→plain-text strip for recipe import

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Shared char budget for import model input (URL path truncates; paste path rejects). */
export const IMPORT_TEXT_MAX_CHARS = 100_000;

export type FetchUrlResult =
  | { ok: true; text: string; finalUrl: string; truncated: boolean }
  | { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_500_000; // ~1.5 MiB
const MAX_REDIRECTS = 5;
const TRUNCATION_MARKER = '\n\n[truncated]';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Private / non-routable nets — fail closed for SSRF. */
const BLOCKED_NETS = new BlockList();
// IPv4 special-use / private
BLOCKED_NETS.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
BLOCKED_NETS.addSubnet('127.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local + cloud metadata
BLOCKED_NETS.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCKED_NETS.addSubnet('192.0.0.0', 24, 'ipv4');
BLOCKED_NETS.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCKED_NETS.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
BLOCKED_NETS.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
BLOCKED_NETS.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved
// IPv6
BLOCKED_NETS.addAddress('::', 'ipv6');
BLOCKED_NETS.addAddress('::1', 'ipv6');
BLOCKED_NETS.addSubnet('fc00::', 7, 'ipv6'); // unique local
BLOCKED_NETS.addSubnet('fe80::', 10, 'ipv6'); // link-local
BLOCKED_NETS.addSubnet('ff00::', 8, 'ipv6'); // multicast

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google',
  'metadata.google.internal',
  'metadata.goog',
]);

function isBlockedAddress(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return BLOCKED_NETS.check(addr, 'ipv4');
  if (version === 6) {
    const lower = addr.toLowerCase();
    // IPv4-mapped ::ffff:a.b.c.d
    const dotted = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) return isBlockedAddress(dotted[1]!);
    // IPv4-mapped ::ffff:aabb:ccdd
    const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      const v4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      return isBlockedAddress(v4);
    }
    return BLOCKED_NETS.check(addr, 'ipv6');
  }
  return true; // fail closed on unparseable
}

function normalizeHostname(hostname: string): string {
  // Node's URL.hostname keeps brackets on IPv6 literals; strip them + FQDN dot
  let h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h.replace(/\.$/, '');
}

function isBlockedHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h.endsWith('.home') || h.endsWith('.localdomain')) return true;
  const ipVersion = isIP(h);
  if (ipVersion) return isBlockedAddress(h);
  return false;
}

/**
 * Validate scheme/userinfo/host and, for non-literal hosts, resolve DNS and
 * block if any address is private (reduces DNS-rebinding risk).
 */
async function assertUrlSafe(
  raw: string,
): Promise<{ ok: true; url: URL } | { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'invalid_url' };
  }

  // Reject credentials in URL (userinfo)
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'invalid_url' };
  }

  const host = normalizeHostname(url.hostname);
  if (!host) return { ok: false, error: 'invalid_url' };

  if (isBlockedHostname(host)) {
    return { ok: false, error: 'blocked_url' };
  }

  // IP literal already checked in isBlockedHostname
  if (isIP(host)) {
    return { ok: true, url };
  }

  // Block-on-resolve: any private/link-local answer ⇒ blocked
  try {
    const answers = await lookup(host, { all: true, verbatim: true });
    if (answers.length === 0) {
      return { ok: false, error: 'blocked_url' }; // fail closed
    }
    for (const a of answers) {
      if (isBlockedAddress(a.address)) {
        return { ok: false, error: 'blocked_url' };
      }
    }
  } catch {
    // DNS failure is a network problem, not a confirmed block
    return { ok: false, error: 'fetch_failed' };
  }

  return { ok: true, url };
}

/** Strip scripts/styles/tags and collapse whitespace — no browser. */
export function htmlToPlainText(html: string): string {
  let s = html;
  // Remove script/style/noscript blocks (including content)
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Drop remaining tags
  s = s.replace(/<[^>]+>/g, ' ');
  // Common entities
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
  if (text.length <= IMPORT_TEXT_MAX_CHARS) {
    return { text, truncated: false };
  }
  const budget = Math.max(0, IMPORT_TEXT_MAX_CHARS - TRUNCATION_MARKER.length);
  return {
    text: text.slice(0, budget) + TRUNCATION_MARKER,
    truncated: true,
  };
}

async function readBodyCapped(
  res: Response,
  maxBytes: number,
): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  const slice = buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf;
  return new TextDecoder('utf-8', { fatal: false }).decode(slice);
}

export async function fetchUrlAsText(
  url: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number },
): Promise<FetchUrlResult> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
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
      const safe = await assertUrlSafe(current);
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
        if (hop === MAX_REDIRECTS) {
          return { ok: false, error: 'fetch_failed' };
        }
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

      if (!res.ok) {
        return { ok: false, error: 'fetch_failed' };
      }

      let body: string;
      try {
        body = await readBodyCapped(res, maxBytes);
      } catch {
        return { ok: false, error: 'fetch_failed' };
      }

      const plain = htmlToPlainText(body);
      const { text, truncated } = truncateText(plain);
      return { ok: true, text, finalUrl: safe.url.href, truncated };
    }

    return { ok: false, error: 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}
