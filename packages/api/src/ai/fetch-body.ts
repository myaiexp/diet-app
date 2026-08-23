// Capped body read + HTML→plain-text for recipe URL import

import { IMPORT_TEXT_MAX_CHARS } from './import-limits.js';
import { describeError } from './log.js';

const TRUNCATION_MARKER = '\n\n[truncated]';

/** Strip scripts/styles/tags and collapse whitespace — no browser. */
export function htmlToPlainText(html: string): string {
  let s = html;
  // Unclosed script/style/noscript/comment: strip to EOF so leftover markup
  // cannot leak into the extraction prompt.
  s = s.replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, ' ');
  s = s.replace(/<style\b[\s\S]*?(?:<\/style>|$)/gi, ' ');
  s = s.replace(/<noscript\b[\s\S]*?(?:<\/noscript>|$)/gi, ' ');
  s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
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

export function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= IMPORT_TEXT_MAX_CHARS) return { text, truncated: false };
  const budget = Math.max(0, IMPORT_TEXT_MAX_CHARS - TRUNCATION_MARKER.length);
  return { text: text.slice(0, budget) + TRUNCATION_MARKER, truncated: true };
}

/** Drop an unread body so undici can release the socket. Cancel errors are noise. */
export async function cancelBody(res: Response): Promise<void> {
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
export async function readBodyCapped(
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
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'aborted mid-body (timeout)' };
      }
      const { done, value } = await reader.read();
      if (signal.aborted) {
        return { ok: false, reason: 'aborted mid-body (timeout)' };
      }
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
    if (signal.aborted) return { ok: false, reason: 'aborted mid-body (timeout)' };
    return { ok: false, reason: describeError(err) };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, text: new TextDecoder('utf-8', { fatal: false }).decode(out) };
}
