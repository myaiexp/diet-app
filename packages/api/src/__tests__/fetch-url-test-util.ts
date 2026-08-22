// Shared fetchUrlAsText test doubles (mock fetch + mock DNS only)

import { vi } from 'vitest';
import type { DnsLookupFn } from '../ai/fetch-url.js';

/** Public IPv4 — never hit real DNS in these tests. */
export const publicDns: DnsLookupFn = async () => [
  { address: '93.184.216.34', family: 4 },
];

export function htmlResponse(html: string, init?: ResponseInit): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });
}

export function mustNotFetch(): typeof fetch {
  return async () => {
    throw new Error('must not fetch');
  };
}

/**
 * A Response whose body stays open until cancel() — models the leak of leaving
 * a 302/4xx/5xx payload unread. Tests assert cancel fired so undici can
 * release the socket.
 */
export function cancellableResponse(
  init: ResponseInit,
  payload = 'unread-payload',
): { response: Response; cancelled: () => boolean } {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      // Intentionally not closed: an unconsumed body staying open is the leak.
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(stream, init), cancelled: () => cancelled };
}

/** Capture logImportFailure's console.error lines for assertion. */
export function captureImportLogs(): { logged: string[] } {
  const logged: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(' '));
  });
  return { logged };
}
