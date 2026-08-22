// SSRF-safe fetchUrlAsText + HTML strip coverage (mock fetch + mock DNS only)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchUrlAsText,
  htmlToPlainText,
  IMPORT_TEXT_MAX_CHARS,
  type DnsLookupFn,
} from '../ai/fetch-url.js';
import {
  captureImportLogs,
  cancellableResponse,
  htmlResponse,
  mustNotFetch,
  publicDns,
} from './fetch-url-test-util.js';

let logged: string[] = [];

beforeEach(() => {
  logged = captureImportLogs().logged;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchUrlAsText', () => {
  test('strips HTML tags to text', async () => {
    const html = `
      <html><head>
        <style>.x { color: red }</style>
        <script>alert('x')</script>
      </head>
      <body>
        <h1>Tomato Soup</h1>
        <p>Boil &amp; simmer for 20 minutes.</p>
      </body></html>
    `;
    const fetchImpl: typeof fetch = async () => htmlResponse(html);
    const result = await fetchUrlAsText('https://example.com/soup', {
      fetchImpl,
      dnsLookup: publicDns,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('Tomato Soup');
    expect(result.text).toContain('Boil & simmer for 20 minutes.');
    expect(result.text).not.toMatch(/<script|alert\(|color:\s*red/i);
    expect(result.truncated).toBe(false);
    expect(result.finalUrl).toBe('https://example.com/soup');
  });

  test('truncates oversize text', async () => {
    const big = 'a'.repeat(IMPORT_TEXT_MAX_CHARS + 5_000);
    const fetchImpl: typeof fetch = async () =>
      htmlResponse(`<html><body><p>${big}</p></body></html>`);
    const result = await fetchUrlAsText('https://example.com/huge', {
      fetchImpl,
      dnsLookup: publicDns,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(IMPORT_TEXT_MAX_CHARS);
    expect(result.text.endsWith('[truncated]')).toBe(true);
  });

  test('maps network failure to fetch_failed', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('network down');
    };
    const result = await fetchUrlAsText('https://example.com/x', {
      fetchImpl,
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
  });

  test('rejects body when Content-Length exceeds maxBytes', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('tiny', {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'content-length': String(5_000_000),
        },
      });
    const result = await fetchUrlAsText('https://example.com/big', {
      fetchImpl,
      dnsLookup: publicDns,
      maxBytes: 1000,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
  });

  test('rejects streamed body once maxBytes is exceeded', async () => {
    const fetchImpl: typeof fetch = async () => {
      const chunk = new Uint8Array(600);
      chunk.fill(65); // 'A'
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk); // 1200 > maxBytes 1000
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    const result = await fetchUrlAsText('https://example.com/stream', {
      fetchImpl,
      dnsLookup: publicDns,
      maxBytes: 1000,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
  });

  test('does not call real DNS when dnsLookup is injected', async () => {
    let lookedUp: string | null = null;
    const dnsLookup: DnsLookupFn = async (hostname) => {
      lookedUp = hostname;
      return [{ address: '1.1.1.1', family: 4 }];
    };
    const fetchImpl: typeof fetch = async () => htmlResponse('<p>ok</p>');
    const result = await fetchUrlAsText('https://example.com/r', {
      fetchImpl,
      dnsLookup,
    });
    expect(result.ok).toBe(true);
    expect(lookedUp).toBe('example.com');
  });

  test('rejects 304 without treating as empty success', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, { status: 304 });
    const result = await fetchUrlAsText('https://example.com/n', {
      fetchImpl,
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
  });

  test('cancels the redirect body before following Location', async () => {
    const hop = cancellableResponse({
      status: 302,
      headers: { Location: 'https://example.com/final' },
    });
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      if (href.endsWith('/start')) return hop.response;
      return htmlResponse('<p>landed</p>');
    };
    const result = await fetchUrlAsText('https://example.com/start', {
      fetchImpl,
      dnsLookup: publicDns,
    });
    expect(result.ok).toBe(true);
    expect(hop.cancelled()).toBe(true);
  });

  test('cancels the body of a redirect without Location', async () => {
    const hop = cancellableResponse({ status: 302 });
    const result = await fetchUrlAsText('https://example.com/start', {
      fetchImpl: async () => hop.response,
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(hop.cancelled()).toBe(true);
  });

  test('cancels every redirect body when the hop cap is exceeded', async () => {
    const hops = Array.from({ length: 6 }, () =>
      cancellableResponse({
        status: 302,
        headers: { Location: 'https://example.com/next' },
      }),
    );
    let i = 0;
    const result = await fetchUrlAsText('https://example.com/start', {
      fetchImpl: async () => hops[i++]!.response,
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(hops.map((h) => h.cancelled())).toEqual(hops.map(() => true));
  });

  test('cancels a non-success response body', async () => {
    const failed = cancellableResponse({ status: 404 });
    const result = await fetchUrlAsText('https://example.com/gone', {
      fetchImpl: async () => failed.response,
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(failed.cancelled()).toBe(true);
  });

  test('cancels a redirect body whose Location is unparseable', async () => {
    const hop = cancellableResponse({
      status: 302,
      headers: { Location: 'http://[not-a-url' },
    });
    const result = await fetchUrlAsText('https://example.com/start', {
      fetchImpl: async () => hop.response,
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'invalid_url' });
    expect(hop.cancelled()).toBe(true);
  });
});

describe('fetchUrlAsText failure logging', () => {
  test('logs the transport cause, not just fetch_failed', async () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = Object.assign(
      new Error('getaddrinfo ENOTFOUND recipes.invalid'),
      { code: 'ENOTFOUND' },
    );
    const result = await fetchUrlAsText('https://example.com/x', {
      fetchImpl: async () => {
        throw err;
      },
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('[recipe-import] transport error');
    expect(logged[0]).toContain('url=https://example.com/x');
    expect(logged[0]).toContain('ENOTFOUND');
  });

  test('logs DNS failure distinctly from transport failure', async () => {
    const result = await fetchUrlAsText('https://example.com/x', {
      fetchImpl: mustNotFetch(),
      dnsLookup: async () => {
        throw Object.assign(new Error('queryA EAI_AGAIN'), { code: 'EAI_AGAIN' });
      },
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(logged[0]).toContain('[recipe-import] dns lookup failed');
    expect(logged[0]).toContain('host=example.com');
    expect(logged[0]).toContain('EAI_AGAIN');
  });

  test('logs the HTTP status behind a non-success response', async () => {
    const result = await fetchUrlAsText('https://example.com/gone', {
      fetchImpl: async () => new Response('nope', { status: 403 }),
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(logged[0]).toContain('[recipe-import] non-success status');
    expect(logged[0]).toContain('status=403');
  });

  test('logs why the body was rejected', async () => {
    const result = await fetchUrlAsText('https://example.com/big', {
      fetchImpl: async () =>
        new Response('tiny', {
          status: 200,
          headers: { 'content-length': String(5_000_000) },
        }),
      dnsLookup: publicDns,
      maxBytes: 1000,
    });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(logged[0]).toContain('[recipe-import] body read failed');
    expect(logged[0]).toContain('content-length 5000000 exceeds cap 1000');
  });
});

describe('htmlToPlainText', () => {
  test('collapses whitespace and drops tags', () => {
    expect(htmlToPlainText('<p>a</p>   <p>b</p>')).toBe('a b');
  });
});
