// Hostname / IP SSRF blocklist helpers for recipe URL import

import { BlockList, isIP } from 'node:net';

/** Private / non-routable nets — fail closed for SSRF. */
const BLOCKED_NETS = new BlockList();
BLOCKED_NETS.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('10.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('100.64.0.0', 10, 'ipv4');
BLOCKED_NETS.addSubnet('127.0.0.0', 8, 'ipv4');
BLOCKED_NETS.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED_NETS.addSubnet('172.16.0.0', 12, 'ipv4');
BLOCKED_NETS.addSubnet('192.0.0.0', 24, 'ipv4');
BLOCKED_NETS.addSubnet('192.168.0.0', 16, 'ipv4');
BLOCKED_NETS.addSubnet('198.18.0.0', 15, 'ipv4');
BLOCKED_NETS.addSubnet('224.0.0.0', 4, 'ipv4');
BLOCKED_NETS.addSubnet('240.0.0.0', 4, 'ipv4');
BLOCKED_NETS.addAddress('::', 'ipv6');
BLOCKED_NETS.addAddress('::1', 'ipv6');
BLOCKED_NETS.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_NETS.addSubnet('fe80::', 10, 'ipv6');
// Deprecated site-local (RFC 3879). fe80::/10 is only fe80–febf; fec0–feff
// is a separate /10 and Node will fetch http://[fec0::1]/ without this.
BLOCKED_NETS.addSubnet('fec0::', 10, 'ipv6');
BLOCKED_NETS.addSubnet('ff00::', 8, 'ipv6');
// 6to4 (2002::/16) and Teredo (2001:0000::/32) embed an IPv4 in the rest of
// the address. Recipe import has no need for either tunnel, so the prefixes
// are blocked wholesale rather than unwrapped — a public IPv4 via 6to4 is
// still a tunnel, and Teredo's client IPv4 is XOR'd.
BLOCKED_NETS.addSubnet('2002::', 16, 'ipv6');
BLOCKED_NETS.addSubnet('2001:0::', 32, 'ipv6');
// RFC 8215 local-use NAT64 64:ff9b:1::/48. Distinct from the well-known
// 64:ff9b::/96 (unwrapped below): a /48 embedding is not last-32-bits, and
// a translator on-path can reconstruct loopback/RFC1918. Import has no need
// for NAT64, so the prefix is blocked wholesale like 6to4/Teredo.
BLOCKED_NETS.addSubnet('64:ff9b:1::', 48, 'ipv6');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google',
  'metadata.google.internal',
  'metadata.goog',
]);

function hexPairToIpv4(hiHex: string, loHex: string): string {
  const hi = parseInt(hiHex, 16);
  const lo = parseInt(loHex, 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/** Unwrap IPv4-mapped, IPv4-compatible, NAT64 well-known, and SIIT embeddings. */
function embeddedIpv4(lower: string): string | null {
  let m: RegExpMatchArray | null;
  m = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) return m[1]!;
  m = lower.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) return m[1]!;
  m = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) return hexPairToIpv4(m[1]!, m[2]!);
  // Deprecated IPv4-compatible ::HHHH:LLLL (e.g. ::7f00:1 → 127.0.0.1). Not ::1.
  m = lower.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) return hexPairToIpv4(m[1]!, m[2]!);
  // NAT64 well-known prefix 64:ff9b::/96
  m = lower.match(/^64:ff9b::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) return m[1]!;
  m = lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) return hexPairToIpv4(m[1]!, m[2]!);
  m = lower.match(/^64:ff9b:0:0:0:0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) return hexPairToIpv4(m[1]!, m[2]!);
  // SIIT IPv4-translated ::ffff:0:0:0/96 (RFC 2765). Distinct from mapped
  // ::ffff:0:0/96 (::ffff:A.B.C.D). Node canonicalizes
  // http://[::ffff:0:127.0.0.1]/ to [::ffff:0:7f00:1].
  m = lower.match(/^::ffff:0:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) return m[1]!;
  m = lower.match(/^::ffff:0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) return hexPairToIpv4(m[1]!, m[2]!);
  m = lower.match(/^0:0:0:0:ffff:0:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) return m[1]!;
  m = lower.match(/^0:0:0:0:ffff:0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) return hexPairToIpv4(m[1]!, m[2]!);
  return null;
}

export function isBlockedAddress(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return BLOCKED_NETS.check(addr, 'ipv4');
  if (version === 6) {
    const v4 = embeddedIpv4(addr.toLowerCase());
    if (v4) return isBlockedAddress(v4);
    return BLOCKED_NETS.check(addr, 'ipv6');
  }
  return true; // fail closed on unparseable
}

export function normalizeHostname(hostname: string): string {
  // Node's URL.hostname keeps brackets on IPv6 literals; strip them + FQDN dot
  let h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h.replace(/\.$/, '');
}

export function isBlockedHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h.endsWith('.home') || h.endsWith('.localdomain')) return true;
  if (isIP(h)) return isBlockedAddress(h);
  return false;
}
