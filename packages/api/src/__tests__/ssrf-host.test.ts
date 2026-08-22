// Direct unit coverage of the SSRF address / hostname blocklist

import { describe, test, expect } from 'vitest';
import {
  isBlockedAddress,
  isBlockedHostname,
  normalizeHostname,
} from '../ai/ssrf-host.js';

describe('isBlockedAddress', () => {
  test.each([
    ['127.0.0.1'],
    ['127.0.0.2'],
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['172.16.0.1'],
    ['172.31.255.1'],
    ['192.168.1.1'],
    ['169.254.169.254'],
    ['169.254.0.1'],
    ['100.64.0.1'],
    ['100.127.255.254'],
    ['0.0.0.0'],
    ['192.0.0.1'],
    ['198.18.0.1'],
    ['224.0.0.1'],
    ['240.0.0.1'],
    ['::'],
    ['::1'],
    ['fc00::1'],
    ['fd12:3456::1'],
    ['fe80::1'],
    ['ff00::1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:7f00:1'],
    ['::7f00:1'],
    ['::127.0.0.1'],
    ['64:ff9b::7f00:1'],
    ['64:ff9b::127.0.0.1'],
    // 6to4 2002::/16 embeds IPv4 in the next 32 bits (2002:7f00:1:: → 127.0.0.1).
    ['2002:7f00:1::'],
    ['2002:7f00:1:0:0:0:0:0'],
    ['2002:c0a8:1::'], // 192.168.0.1 via 6to4 — prefix is blocked wholesale
    // Teredo 2001:0000::/32. Wikipedia's example client, and the prefix itself.
    ['2001:0::'],
    ['2001:0000:4136:e378:8000:63bf:3fff:fdd2'],
    ['not-an-ip'],
    [''],
  ])('blocks %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  test.each([
    ['1.1.1.1'],
    ['8.8.8.8'],
    ['93.184.216.34'],
    ['2.2.2.2'],
    ['2001:4860:4860::8888'],
    ['2606:4700:4700::1111'],
  ])('allows public %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(false);
  });
});

describe('isBlockedHostname', () => {
  test.each([
    ['localhost'],
    ['metadata'],
    ['metadata.google'],
    ['metadata.google.internal'],
    ['metadata.goog'],
    ['foo.localhost'],
    ['bar.foo.localhost'],
    ['printer.local'],
    ['n.internal'],
    ['gateway.lan'],
    ['nas.home'],
    ['box.localdomain'],
    ['127.0.0.1'],
    ['169.254.169.254'],
    ['100.64.0.1'],
    ['[::1]'],
  ])('blocks %s', (host) => {
    expect(isBlockedHostname(host)).toBe(true);
  });

  test.each([['example.com'], ['cdn.example.org'], ['recipes.io']])(
    'allows public hostname %s',
    (host) => {
      expect(isBlockedHostname(host)).toBe(false);
    },
  );
});

describe('normalizeHostname', () => {
  test('strips IPv6 brackets and a trailing FQDN dot', () => {
    expect(normalizeHostname('[::1]')).toBe('::1');
    expect(normalizeHostname('Example.COM.')).toBe('example.com');
  });
});
