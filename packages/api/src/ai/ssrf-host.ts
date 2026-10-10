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

/**
 * Parse an IPv6 literal into its eight 16-bit groups. The WHATWG URL parser
 * does the parsing, so every spelling isIP accepts (dotted tail, leading
 * zeros, uppercase, uncompressed) reduces to one canonical text with no dotted
 * part and at most one "::". Null when the URL parser refuses the literal,
 * e.g. a zone id (fe80::1%eth0).
 */
function ipv6Groups(addr: string): number[] | null {
  let host: string;
  try {
    host = new URL(`http://[${addr}]/`).hostname;
  } catch {
    return null;
  }
  const [head = '', tail] = host.slice(1, -1).split('::');
  const groups = (s: string) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const hi = groups(head);
  if (tail === undefined) return hi.length === 8 ? hi : null;
  const lo = groups(tail);
  return [...hi, ...new Array<number>(8 - hi.length - lo.length).fill(0), ...lo];
}

/**
 * The IPv4 address an IPv6 address carries in its low 32 bits, for the four
 * /96 embeddings a connect can reach that IPv4 through. Classified on the
 * parsed groups, never the raw text, so no spelling slips past.
 */
function embeddedIpv4(g: number[]): string | null {
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const hi = g[6]!;
  const lo = g[7]!;
  const v4 = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // IPv4-mapped ::ffff:0:0/96.
  if (zero(0, 5) && g[5] === 0xffff) return v4;
  // SIIT IPv4-translated ::ffff:0:0:0/96 (RFC 2765), distinct from mapped.
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return v4;
  // Deprecated IPv4-compatible ::/96. :: and ::1 land in 0.0.0.0/8, blocked.
  if (zero(0, 6)) return v4;
  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052).
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4;
  return null;
}

export function isBlockedAddress(addr: string): boolean {
  const version = isIP(addr);
  if (version === 4) return BLOCKED_NETS.check(addr, 'ipv4');
  if (version === 6) {
    const groups = ipv6Groups(addr);
    if (!groups) return true;
    const v4 = embeddedIpv4(groups);
    if (v4) return isBlockedAddress(v4);
    // Reserved ::/8 (RFC 4291) outside those embeddings is unroutable. Checked
    // here rather than in BLOCKED_NETS: BlockList matches IPv4 addresses
    // against IPv6 rules as ::ffff:a.b.c.d, so a ::/8 rule there blocks all IPv4.
    if (groups[0]! < 0x100) return true;
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
