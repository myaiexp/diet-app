// Unit tests for import-port allowlist and pinned DNS lookup

import { describe, test, expect } from 'vitest';
import {
  isAllowedImportPort,
  pinnedLookup,
} from '../ai/ssrf-pin.js';

function lookup(
  fn: ReturnType<typeof pinnedLookup>,
  hostname: string,
  options: { all?: boolean; family?: number } = {},
): Promise<{ address: string; family?: number } | Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    fn(hostname, options, (err, address, family) => {
      if (err) {
        reject(err);
        return;
      }
      if (Array.isArray(address)) {
        resolve(address);
        return;
      }
      resolve({ address, family });
    });
  });
}

describe('isAllowedImportPort', () => {
  test('allows http/https default and explicit 80/443', () => {
    expect(isAllowedImportPort(new URL('http://example.com/r'))).toBe(true);
    expect(isAllowedImportPort(new URL('https://example.com/r'))).toBe(true);
    expect(isAllowedImportPort(new URL('http://example.com:80/r'))).toBe(true);
    expect(isAllowedImportPort(new URL('https://example.com:443/r'))).toBe(true);
  });

  test('rejects any other port', () => {
    expect(isAllowedImportPort(new URL('http://example.com:8080/r'))).toBe(false);
    expect(isAllowedImportPort(new URL('https://example.com:8443/r'))).toBe(false);
    expect(isAllowedImportPort(new URL('http://example.com:5432/r'))).toBe(false);
    expect(isAllowedImportPort(new URL('https://1.1.1.1:22/r'))).toBe(false);
    expect(isAllowedImportPort(new URL('https://example.com:80/r'))).toBe(false);
  });
});

describe('pinnedLookup', () => {
  const allowed = [
    { address: '1.1.1.1', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ] as const;

  test('returns the first allowed address for the expected host', async () => {
    const fn = pinnedLookup('example.com', allowed);
    await expect(lookup(fn, 'example.com')).resolves.toEqual({
      address: '1.1.1.1',
      family: 4,
    });
  });

  test('returns the full set when all is true', async () => {
    const fn = pinnedLookup('example.com', allowed);
    await expect(lookup(fn, 'example.com', { all: true })).resolves.toEqual([
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  test('filters by family when requested', async () => {
    const fn = pinnedLookup('example.com', allowed);
    await expect(lookup(fn, 'example.com', { family: 6 })).resolves.toEqual({
      address: '2606:4700:4700::1111',
      family: 6,
    });
  });

  test('rejects a lookup for a different hostname', async () => {
    const fn = pinnedLookup('example.com', allowed);
    await expect(lookup(fn, 'evil.example')).rejects.toThrow(/unexpected lookup host/);
  });

  test('rejects an empty pin set', async () => {
    const fn = pinnedLookup('example.com', []);
    await expect(lookup(fn, 'example.com')).rejects.toThrow(/no allowed addresses/);
  });
});
