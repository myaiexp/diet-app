// SSRF guards on fetchUrlAsText: literals, DNS answers, hostnames

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchUrlAsText, type DnsLookupFn } from '../ai/fetch-url.js';
import {
  captureImportLogs,
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

describe('fetchUrlAsText URL / hostname blocklist', () => {
  test('rejects non-http schemes', async () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/a',
      'javascript:alert(1)',
      'data:text/html,hi',
    ]) {
      const result = await fetchUrlAsText(url, {
        fetchImpl: mustNotFetch(),
        dnsLookup: publicDns,
      });
      expect(result).toEqual({ ok: false, error: 'invalid_url' });
    }
  });

  test('rejects credentials in URL', async () => {
    const result = await fetchUrlAsText('https://user:pass@example.com/recipe', {
      fetchImpl: mustNotFetch(),
      dnsLookup: publicDns,
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
        fetchImpl: mustNotFetch(),
        dnsLookup: publicDns,
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
      'http://100.64.0.1/x',
    ]) {
      const result = await fetchUrlAsText(url, {
        fetchImpl: mustNotFetch(),
        dnsLookup: publicDns,
      });
      expect(result, url).toEqual({ ok: false, error: 'blocked_url' });
    }
  });

  test('rejects IPv6 ULA, link-local, mapped, and compatible embeds', async () => {
    for (const url of [
      'http://[fc00::1]/x',
      'http://[fe80::1]/x',
      'http://[fec0::1]/x',
      'http://[::ffff:127.0.0.1]/x',
      'http://[::ffff:7f00:1]/x',
      'http://[::7f00:1]/x',
      'http://[::127.0.0.1]/x',
      'http://[64:ff9b::7f00:1]/x',
      'http://[64:ff9b::127.0.0.1]/x',
      // SIIT IPv4-translated. Node canonicalizes the dotted form to hex.
      'http://[::ffff:0:127.0.0.1]/x',
      'http://[::ffff:0:7f00:1]/x',
      'http://[::ffff:0:a9fe:a9fe]/x',
      'http://[0:0:0:0:ffff:0:7f00:1]/x',
      // RFC 8215 local-use NAT64 — prefix blocked wholesale; literals skip DNS.
      'http://[64:ff9b:1::7f00:1]/x',
      'http://[64:ff9b:1::127.0.0.1]/x',
      // 6to4 / Teredo embeddings of loopback — IP literals skip DNS, so the
      // blocklist must catch them or parseSafeUrl would fetch.
      'http://[2002:7f00:1::]/x',
      'http://[2001:0::]/x',
    ]) {
      const result = await fetchUrlAsText(url, {
        fetchImpl: mustNotFetch(),
        dnsLookup: publicDns,
      });
      expect(result, url).toEqual({ ok: false, error: 'blocked_url' });
    }
  });

  test('rejects metadata and internal hostnames without fetching', async () => {
    for (const url of [
      'http://metadata.google.internal/latest/meta-data/',
      'http://foo.localhost/x',
      'http://printer.local/x',
      'http://svc.internal/x',
      'http://gateway.lan/x',
    ]) {
      let fetched = false;
      const result = await fetchUrlAsText(url, {
        fetchImpl: async () => {
          fetched = true;
          throw new Error('must not fetch');
        },
        dnsLookup: async () => {
          throw new Error('must not look up blocked hostname');
        },
      });
      expect(result, url).toEqual({ ok: false, error: 'blocked_url' });
      expect(fetched, url).toBe(false);
    }
  });
});

describe('fetchUrlAsText DNS-answer blocklist', () => {
  test.each([
    ['127.0.0.1', 4],
    ['169.254.169.254', 4],
    ['10.0.0.1', 4],
    ['::ffff:127.0.0.1', 6],
    ['::ffff:0:7f00:1', 6],
    ['::ffff:0:a9fe:a9fe', 6],
    ['0:0:0:0:ffff:0:7f00:1', 6],
    ['64:ff9b:1::7f00:1', 6],
    ['64:ff9b:1::0808:0808', 6],
  ] as const)(
    'blocks https://example.com when DNS returns %s',
    async (address, family) => {
      let fetched = false;
      const dnsLookup: DnsLookupFn = async () => [{ address, family }];
      const result = await fetchUrlAsText('https://example.com/recipe', {
        fetchImpl: async () => {
          fetched = true;
          throw new Error('must not fetch');
        },
        dnsLookup,
      });
      expect(result).toEqual({ ok: false, error: 'blocked_url' });
      expect(fetched).toBe(false);
    },
  );

  test('blocks an empty DNS answer set (fail closed)', async () => {
    let fetched = false;
    const result = await fetchUrlAsText('https://example.com/recipe', {
      fetchImpl: async () => {
        fetched = true;
        throw new Error('must not fetch');
      },
      dnsLookup: async () => [],
    });
    expect(result).toEqual({ ok: false, error: 'blocked_url' });
    expect(fetched).toBe(false);
  });

  test('blocks a mixed public+private answer set', async () => {
    let fetched = false;
    const result = await fetchUrlAsText('https://example.com/recipe', {
      fetchImpl: async () => {
        fetched = true;
        throw new Error('must not fetch');
      },
      dnsLookup: async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    });
    expect(result).toEqual({ ok: false, error: 'blocked_url' });
    expect(fetched).toBe(false);
  });
});

describe('fetchUrlAsText SSRF logging', () => {
  test('logs a rejected redirect target (the user URL was fine)', async () => {
    let calls = 0;
    const result = await fetchUrlAsText('https://example.com/start', {
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
        });
      },
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'blocked_url' });
    expect(calls).toBe(1);
    expect(logged[0]).toContain('[recipe-import] redirect target rejected');
    expect(logged[0]).toContain('hop=1');
    expect(logged[0]).toContain('blocked_url');
  });

  test('rejects a 302 Location that carries userinfo on a public host', async () => {
    const fetched: string[] = [];
    const result = await fetchUrlAsText('https://example.com/start', {
      fetchImpl: async (url) => {
        fetched.push(url);
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://user:pass@example.com/recipe' },
        });
      },
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'invalid_url' });
    expect(fetched).toEqual(['https://example.com/start']);
    expect(logged[0]).toContain('[recipe-import] redirect target rejected');
    expect(logged[0]).toContain('hop=1');
    expect(logged[0]).toContain('invalid_url');
    // The rejected hop is logged; its credentials must not reach journald.
    expect(logged[0]).not.toContain('pass');
    expect(logged[0]).toContain('url=https://***:***@example.com/recipe');
  });

  test('rejects a 302 Location whose userinfo wraps a blocked host', async () => {
    // Credentials are rejected before the host check, so this is invalid_url
    // today; blocked_url after stripping userinfo would also be fail-closed.
    // Either way hop 1 must not fetch https://user:pass@127.0.0.1/.
    const fetched: string[] = [];
    const result = await fetchUrlAsText('https://example.com/start', {
      fetchImpl: async (url) => {
        fetched.push(url);
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://user:pass@127.0.0.1/' },
        });
      },
      dnsLookup: publicDns,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(['invalid_url', 'blocked_url']).toContain(result.error);
    expect(fetched).toEqual(['https://example.com/start']);
    expect(fetched.some((u) => u.includes('user:pass'))).toBe(false);
    expect(logged[0]).toContain('[recipe-import] redirect target rejected');
    expect(logged[0]).toContain('hop=1');
    expect(logged[0]).not.toContain('pass');
  });

  test('stays silent when the user URL itself is rejected (expected 400)', async () => {
    const result = await fetchUrlAsText('http://127.0.0.1/secret', {
      fetchImpl: mustNotFetch(),
      dnsLookup: publicDns,
    });
    expect(result).toEqual({ ok: false, error: 'blocked_url' });
    expect(logged).toEqual([]);
  });
});
