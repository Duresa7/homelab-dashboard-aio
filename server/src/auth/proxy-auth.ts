export interface ProxyAuthConfig {
  enabled: boolean;

  header: string;

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

export function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

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
