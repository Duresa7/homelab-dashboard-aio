// SSRF guard for server-initiated requests whose destination is influenced by
// untrusted input (integration base URLs, the connection-test endpoint, the DB
// host). This is a homelab dashboard: its legitimate targets live on the LAN,
// so private ranges (10/8, 172.16/12, 192.168/16) are ALLOWED, and loopback is
// allowed too (a database or a co-located service is commonly reached on
// localhost). What we block is the address space that is never a valid
// user-supplied target and exists only to be abused from the server: the
// link-local range — which includes the 169.254.169.254 cloud-metadata
// endpoint — and the unspecified address. Authentication is the primary access
// control on these endpoints; this is defense-in-depth against the metadata
// SSRF specifically.
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export class BlockedHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedHostError';
  }
}

function ipv4Octets(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [
    number,
    number,
    number,
    number,
  ];
  return octets.some((n) => n > 255) ? null : octets;
}

function isBlockedIpv4(ip: string): boolean {
  const octets = ipv4Octets(ip);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this host" / unspecified
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. metadata)
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // drop any zone id
  if (addr === '::') return true; // unspecified
  // IPv4-mapped/-compatible (e.g. ::ffff:169.254.169.254) — judge by the v4 part.
  const mapped = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(addr);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  return false;
}

/** True if the literal IP must never be the target of a user-driven request
 * (link-local / metadata / unspecified). Loopback and private/public are OK. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return false;
}

/** Pull a hostname out of a URL or a bare `host` / `host:port` string. */
export function hostFromInput(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  if (isIP(raw)) return raw;
  try {
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return url.hostname.replace(/^\[/, '').replace(/\]$/, ''); // unwrap IPv6 brackets
  } catch {
    return raw;
  }
}

/**
 * Reject a server-initiated request whose destination is the link-local/
 * metadata range or the unspecified address. Accepts a URL or a bare
 * host[:port]. For a hostname, every resolved address is checked. Throws
 * {@link BlockedHostError} when blocked; resolves otherwise. An unresolvable
 * hostname is left to fail naturally at connect time rather than blocked here.
 *
 * Note: hostname resolution here is best-effort against DNS pointing at a
 * blocked range; it does not fully close a rebinding TOCTOU between this check
 * and the later connection.
 */
export async function assertAllowedHost(input: string): Promise<void> {
  const host = hostFromInput(input);
  if (!host) throw new BlockedHostError('destination host is empty');
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedHostError(`destination address ${host} is not allowed`);
    return;
  }
  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    return; // unresolvable — the request will fail on its own
  }
  for (const { address } of resolved) {
    if (isBlockedIp(address)) {
      throw new BlockedHostError(`destination host "${host}" resolves to a blocked address`);
    }
  }
}
