// Optional reverse-proxy auth (Authentik/Authelia forward-auth style). Off by
// default; when enabled, a username header from a trusted proxy IP maps onto an
// EXISTING local user — the header decides who logs in, never who exists or
// what role they get. Unknown header users are rejected.

export interface ProxyAuthConfig {
  enabled: boolean;
  /** Header carrying the username, lowercase (Node lowercases header names). */
  header: string;
  /** Exact remote IPs allowed to assert the header. Empty set = trust nothing. */
  trustedIps: Set<string>;
}

export function parseProxyAuthConfig(env: NodeJS.ProcessEnv = process.env): ProxyAuthConfig {
  const enabled = (env.AUTH_PROXY_ENABLED ?? '').toLowerCase() === 'true';
  const header = (env.AUTH_PROXY_HEADER || 'remote-user').toLowerCase();
  const trustedIps = new Set(
    (env.AUTH_PROXY_TRUSTED_IPS ?? '')
      .split(',')
      .map((ip) => normalizeIp(ip.trim()))
      .filter(Boolean),
  );
  return { enabled, header, trustedIps };
}

/** Strip the IPv4-mapped-IPv6 prefix Express reports (::ffff:192.0.2.1). */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Returns the asserted username when proxy auth applies to this request, else
 * null. Callers still must resolve the username to a real local user.
 */
export function proxyAssertedUser(
  config: ProxyAuthConfig,
  remoteIp: string | undefined,
  headerValue: string | string[] | undefined,
): string | null {
  if (!config.enabled) return null;
  if (!config.trustedIps.has(normalizeIp(remoteIp))) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const username = raw?.trim().toLowerCase();
  return username ? username : null;
}
