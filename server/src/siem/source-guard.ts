/**
 * Source filtering for the SIEM UDP listener (HD-CAN-004).
 *
 * Default-deny: when the listener would bind a non-loopback address and no
 * source allowlist is configured, the bind falls back to loopback so remote
 * hosts cannot inject events until the operator sets SIEM_ALLOWED_SOURCES.
 */

export interface SourceFilter {
  /** Exact IPv4 addresses allowed to send. */
  ips: Set<string>;
  /** IPv4 CIDR ranges allowed to send. */
  cidrs: { base: number; maskBits: number }[];
  /** True when the operator explicitly opted out of filtering with '*'. */
  allowAny: boolean;
}

export interface BindResolution {
  host: string;
  /** True when the requested host was replaced by loopback (no allowlist). */
  loopbackFallback: boolean;
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/**
 * Parse SIEM_ALLOWED_SOURCES: a comma-separated list of IPv4 addresses and/or
 * CIDR ranges (e.g. "192.0.2.1,192.0.2.0/24"). A single '*' disables source
 * filtering entirely (explicit opt-out). Returns null when nothing is
 * configured; invalid entries are reported via onInvalid and skipped.
 */
export function parseAllowedSources(
  raw: string | undefined,
  onInvalid?: (entry: string) => void,
): SourceFilter | null {
  const entries = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entries.length) return null;

  const filter: SourceFilter = { ips: new Set(), cidrs: [], allowAny: false };
  for (const entry of entries) {
    if (entry === '*') {
      filter.allowAny = true;
      continue;
    }
    const [ip, maskPart, ...rest] = entry.split('/');
    const ipInt = ipv4ToInt(ip);
    if (ipInt === null || rest.length > 0) {
      onInvalid?.(entry);
      continue;
    }
    if (maskPart === undefined) {
      filter.ips.add(ip);
      continue;
    }
    const maskBits = Number(maskPart);
    if (!/^\d{1,2}$/.test(maskPart) || maskBits > 32) {
      onInvalid?.(entry);
      continue;
    }
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    filter.cidrs.push({ base: (ipInt & mask) >>> 0, maskBits });
  }

  if (!filter.allowAny && !filter.ips.size && !filter.cidrs.length) return null;
  return filter;
}

/** IPv4-mapped IPv6 ("::ffff:192.0.2.1") normalizes to plain IPv4. */
function normalizeSourceIp(ip: string): string {
  const lower = ip.toLowerCase();
  return lower.startsWith('::ffff:') ? lower.slice(7) : lower;
}

export function isSourceAllowed(filter: SourceFilter | null, sourceIp: string): boolean {
  // No filter means the listener is loopback-only (see resolveBindHost), so
  // anything that reaches it is local by construction.
  if (!filter) return true;
  if (filter.allowAny) return true;
  const ip = normalizeSourceIp(sourceIp);
  if (filter.ips.has(ip)) return true;
  if (!filter.cidrs.length) return false;
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  return filter.cidrs.some(({ base, maskBits }) => {
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    return (ipInt & mask) >>> 0 === base;
  });
}

/**
 * Default-deny bind: a non-loopback bind address without a configured
 * allowlist falls back to 127.0.0.1 until the operator sets
 * SIEM_ALLOWED_SOURCES.
 */
export function resolveBindHost(host: string, filter: SourceFilter | null): BindResolution {
  if (filter || isLoopbackHost(host)) return { host, loopbackFallback: false };
  return { host: '127.0.0.1', loopbackFallback: true };
}
