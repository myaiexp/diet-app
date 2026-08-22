// Pin import TCP connects to already-allowed DNS answers

import type { LookupAddress, LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { isBlockedAddress, normalizeHostname } from './ssrf-host.js';

export type ResolvedAddress = { address: string; family: number };

export type ImportDispatcher = {
  close: () => void | Promise<void>;
};

export type CreateDispatcherFn = (
  hostname: string,
  addresses: ReadonlyArray<ResolvedAddress>,
) => ImportDispatcher | undefined;

/** http:80 and https:443 only — default or explicit. */
export function isAllowedImportPort(url: URL): boolean {
  if (url.protocol === 'http:') return url.port === '' || url.port === '80';
  if (url.protocol === 'https:') return url.port === '' || url.port === '443';
  return false;
}

function familyOf(options: LookupOptions): number {
  const family = options.family;
  if (family === 'IPv4' || family === 4) return 4;
  if (family === 'IPv6' || family === 6) return 6;
  return 0;
}

function matching(
  allowed: ReadonlyArray<ResolvedAddress>,
  options: LookupOptions,
): ResolvedAddress[] {
  const family = familyOf(options);
  if (family === 4 || family === 6) {
    return allowed.filter((a) => a.family === family);
  }
  return [...allowed];
}

function lookupError(message: string, code = 'ENOTFOUND'): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/**
 * Connect-time lookup that never re-resolves: undici gets the addresses
 * parseSafeUrl already allowed. Host/SNI stay on the original name.
 */
export function pinnedLookup(
  expectedHost: string,
  allowed: ReadonlyArray<ResolvedAddress>,
): LookupFunction {
  const expected = normalizeHostname(expectedHost);
  return (hostname, options, callback) => {
    if (normalizeHostname(hostname) !== expected) {
      callback(lookupError(`unexpected lookup host ${hostname}`), '', 4);
      return;
    }
    if (allowed.some((a) => isBlockedAddress(a.address))) {
      callback(lookupError('blocked address in pin set'), '', 4);
      return;
    }
    const chosen = matching(allowed, options);
    if (chosen.length === 0) {
      callback(lookupError('no allowed addresses'), '', 4);
      return;
    }
    if (options.all) {
      callback(null, chosen as LookupAddress[]);
      return;
    }
    const first = chosen[0]!;
    callback(null, first.address, first.family);
  };
}

export function createPinnedDispatcher(
  hostname: string,
  addresses: ReadonlyArray<ResolvedAddress>,
): ImportDispatcher {
  return new Agent({
    connect: {
      lookup: pinnedLookup(hostname, addresses),
    },
  });
}
