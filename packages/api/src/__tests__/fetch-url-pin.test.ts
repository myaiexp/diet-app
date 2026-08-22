// Port allowlist + DNS-pin wiring for fetchUrlAsText (mock fetch + mock DNS)

import { describe, test, expect, vi, afterEach } from 'vitest';
import { fetchUrlAsText, type DnsLookupFn } from '../ai/fetch-url.js';
import { htmlResponse, publicDns } from './fetch-url-test-util.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchUrlAsText port restriction', () => {
  test('rejects non-80/443 ports without fetching', async () => {
    for (const url of [
      'http://example.com:8080/r',
      'https://example.com:8443/r',
      'http://example.com:5432/r',
      'https://1.1.1.1:22/r',
    ]) {
      let fetched = false;
      const result = await fetchUrlAsText(url, {
        fetchImpl: async () => {
          fetched = true;
          throw new Error('must not fetch');
        },
        dnsLookup: publicDns,
      });
      expect(result, url).toEqual({ ok: false, error: 'blocked_url' });
      expect(fetched, url).toBe(false);
    }
  });

  test('allows explicit default ports 80 and 443', async () => {
    const resultHttp = await fetchUrlAsText('http://example.com:80/r', {
      fetchImpl: async () => htmlResponse('<p>ok</p>'),
      dnsLookup: publicDns,
    });
    expect(resultHttp.ok).toBe(true);

    const resultHttps = await fetchUrlAsText('https://example.com:443/r', {
      fetchImpl: async () => htmlResponse('<p>ok</p>'),
      dnsLookup: publicDns,
    });
    expect(resultHttps.ok).toBe(true);
  });
});

describe('fetchUrlAsText DNS pinning', () => {
  test('pins connect to the DNS answers that passed the blocklist', async () => {
    const calls: Array<{
      host: string;
      addresses: Array<{ address: string; family: number }>;
    }> = [];
    const result = await fetchUrlAsText('https://example.com/r', {
      fetchImpl: async () => htmlResponse('<p>ok</p>'),
      dnsLookup: async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
      createDispatcher: (host, addresses) => {
        calls.push({ host, addresses: [...addresses] });
        return undefined;
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        host: 'example.com',
        addresses: [
          { address: '1.1.1.1', family: 4 },
          { address: '2606:4700:4700::1111', family: 6 },
        ],
      },
    ]);
  });

  test('production dispatcher is a closeable Agent passed into fetch', async () => {
    let seen: { close?: unknown } | undefined;
    const result = await fetchUrlAsText('https://example.com/r', {
      fetchImpl: async (_url, init) => {
        seen = init?.dispatcher;
        return htmlResponse('<p>ok</p>');
      },
      dnsLookup: async () => [{ address: '1.1.1.1', family: 4 }],
    });
    expect(result.ok).toBe(true);
    expect(typeof seen?.close).toBe('function');
  });

  test('does not create a dispatcher for IP literals', async () => {
    let created = false;
    const result = await fetchUrlAsText('https://1.1.1.1/r', {
      fetchImpl: async () => htmlResponse('<p>ok</p>'),
      dnsLookup: async () => {
        throw new Error('literals skip DNS');
      },
      createDispatcher: () => {
        created = true;
        return undefined;
      },
    });
    expect(result.ok).toBe(true);
    expect(created).toBe(false);
  });

  test('re-pins on each redirect hop', async () => {
    const hosts: string[] = [];
    const dnsLookup: DnsLookupFn = async (hostname) => {
      if (hostname === 'example.com') return [{ address: '1.1.1.1', family: 4 }];
      if (hostname === 'cdn.example.org')
        return [{ address: '8.8.8.8', family: 4 }];
      throw new Error(`unexpected host ${hostname}`);
    };
    const result = await fetchUrlAsText('https://example.com/start', {
      fetchImpl: async (input) => {
        if (String(input).includes('/start')) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://cdn.example.org/final' },
          });
        }
        return htmlResponse('<p>ok</p>');
      },
      dnsLookup,
      createDispatcher: (host) => {
        hosts.push(host);
        return undefined;
      },
    });
    expect(result.ok).toBe(true);
    expect(hosts).toEqual(['example.com', 'cdn.example.org']);
  });
});
