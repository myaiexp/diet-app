// SSRF-safe fetchUrlAsText + HTML strip coverage (mock fetch only)

import { describe, test, expect } from 'vitest';
import {
  fetchUrlAsText,
  htmlToPlainText,
  IMPORT_TEXT_MAX_CHARS,
} from '../ai/fetch-url.js';

function htmlResponse(html: string, init?: ResponseInit): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });
}

describe('fetchUrlAsText', () => {
  test('rejects non-http schemes', async () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/a',
      'javascript:alert(1)',
      'data:text/html,hi',
    ]) {
      const result = await fetchUrlAsText(url, {
        fetchImpl: async () => {
          throw new Error('must not fetch');
        },
      });
      expect(result).toEqual({ ok: false, error: 'invalid_url' });
    }
  });

  test('rejects credentials in URL', async () => {
    const result = await fetchUrlAsText('https://user:pass@example.com/recipe', {
      fetchImpl: async () => {
        throw new Error('must not fetch');
      },
    });
    expect(result).toEqual({ ok: false, error: 'invalid_url' });
  });

  test('rejects loopback host', async () => {
    for (const url of [
      'http://localhost/secret',
      'http://127.0.0.1/secret',
      'http://[::1]/secret',
    ]) {
      const result = await fetchUrlAsText(url, {
        fetchImpl: async () => {
          throw new Error('must not fetch');
        },
      });
      expect(result).toEqual({ ok: false, error: 'blocked_url' });
    }
  });

  test('rejects private IPv4 literal', async () => {
    for (const url of [
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://172.16.0.1/x',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      const result = await fetchUrlAsText(url, {
        fetchImpl: async () => {
          throw new Error('must not fetch');
        },
      });
      expect(result).toEqual({ ok: false, error: 'blocked_url' });
    }
  });

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
    const result = await fetchUrlAsText('https://example.com/soup', { fetchImpl });
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
    const result = await fetchUrlAsText('https://example.com/huge', { fetchImpl });
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
    const result = await fetchUrlAsText('https://example.com/x', { fetchImpl });
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
  });

  test('blocks redirect to private host', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1/secret' },
        });
      }
      throw new Error('must not follow blocked redirect');
    };
    const result = await fetchUrlAsText('https://example.com/start', { fetchImpl });
    expect(result).toEqual({ ok: false, error: 'blocked_url' });
    expect(calls).toBe(1);
  });
});

describe('htmlToPlainText', () => {
  test('collapses whitespace and drops tags', () => {
    expect(htmlToPlainText('<p>a</p>   <p>b</p>')).toBe('a b');
  });
});
