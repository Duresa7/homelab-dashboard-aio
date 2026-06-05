// UniFi Network integration. Normalizes the gateway, switches, APs, clients,
// networks/SSIDs, firewall, VPN, and DNS into the dashboard's `unifi` slice
// (plus a derived `network` slice).
import type { Express, Request, Response } from 'express';

import { insecureFetch } from '../lib/http.js';
import { withTtlCache } from '../lib/cache.js';
import { isDebugEndpointEnabled, isEnabled, formatUptime } from '../lib/env.js';
import { errorMessage } from '../lib/errors.js';
import type { Upstream } from '../types.js';

const CACHE_TTL = Number(process.env.UNIFI_POLL_INTERVAL) || 10000;

export interface UnifiRuntimeConfig {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  site?: string;
}

function configFromEnv(): UnifiRuntimeConfig {
  return {
    enabled: isEnabled(process.env.UNIFI_ENABLED, false),
    baseUrl: process.env.UNIFI_BASE_URL,
    apiKey: process.env.UNIFI_API_KEY || '',
    site: process.env.UNIFI_SITE || 'default',
  };
}

let config = configFromEnv();

async function uniFetch(path: string): Promise<Upstream> {
  if (!config.baseUrl) throw new Error('UniFi base URL is not configured');
  const url = `${config.baseUrl}${path}`;
  const res = await insecureFetch(url, {
    headers: {
      'X-API-Key': config.apiKey ?? '',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UniFi API ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchAllPages(basePath: string, limit = 200): Promise<Upstream[]> {
  let all: Upstream[] = [];
  let offset = 0;
  while (true) {
    const sep = basePath.includes('?') ? '&' : '?';
    const res = await uniFetch(`${basePath}${sep}limit=${limit}&offset=${offset}`);
    const items = res.data || [];
    all = all.concat(items);
    if (items.length < limit || all.length >= (res.totalCount || Infinity)) break;
    offset += limit;
  }
  return all;
}

async function safeFetch(path: string): Promise<Upstream> {
  try {
    return await uniFetch(path);
  } catch {
    return null;
  }
}

async function safeFetchAllPages(basePath: string, limit = 200): Promise<Upstream[]> {
  try {
    return await fetchAllPages(basePath, limit);
  } catch {
    return [];
  }
}

let resolvedSiteId: string | null = null;

async function getSiteId(): Promise<string> {
  if (resolvedSiteId) return resolvedSiteId;
  const res = await uniFetch('/proxy/network/integration/v1/sites');
  const sites = res.data || res;
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new Error('No sites found from UniFi API');
  }
  const siteName = config.site || 'default';
  const site = sites.find((s: Upstream) => s.name === siteName || s.id === siteName) || sites[0];
  resolvedSiteId = site.id || site._id || site.name;
  return resolvedSiteId as string;
}

function hasFeature(d: Upstream, name: string) {
  const f = d.features;
  if (Array.isArray(f)) return f.includes(name);
  if (f && typeof f === 'object') return f[name] !== undefined && f[name] !== null;
  return false;
}

function classifyDevice(d: Upstream) {
  const model = (d.model || '').toLowerCase();

  const gwKeywords = ['ucg', 'udm', 'uxg', 'gateway', 'dream machine', 'cloud key'];
  if (gwKeywords.some((kw) => model.includes(kw))) return 'gateway';

  const switchKeywords = ['usw', 'switch', 'us-', 'usp-'];
  const apKeywords = ['uap', 'u6', 'u7', 'nanohd', 'ac-pro', 'ac-lite', 'ap'];

  if (hasFeature(d, 'switching') || switchKeywords.some((kw) => model.includes(kw))) {
    return 'switch';
  }

  if (hasFeature(d, 'accessPoint') || apKeywords.some((kw) => model.includes(kw))) {
    return 'ap';
  }

  return 'other';
}

async function fetchUnifiDataRaw() {
  const siteId = await getSiteId();
  const prefix = `/proxy/network/integration/v1/sites/${siteId}`;

  // The 5th call (`/wans`) is still issued for parity, but its result isn't
  // surfaced in this slice — an array hole skips binding it without a lint flag.
  const [devices, clients, networks, ssids, , fwZones, fwPolicies, vpnServers, dnsRecords] =
    await Promise.all([
      fetchAllPages(`${prefix}/devices`),
      fetchAllPages(`${prefix}/clients`),
      safeFetchAllPages(`${prefix}/networks`),
      safeFetchAllPages(`${prefix}/wifi/broadcasts`),
      safeFetchAllPages(`${prefix}/wans`),
      safeFetchAllPages(`${prefix}/firewall/zones`),
      safeFetchAllPages(`${prefix}/firewall/policies`),
      safeFetchAllPages(`${prefix}/vpn/servers`),
      safeFetchAllPages(`${prefix}/dns/policies`),
    ]);

  let appVersion = null;
  const appInfo = await safeFetch('/proxy/network/integration/v1/info');
  if (appInfo) appVersion = appInfo.applicationVersion || null;

  const statsMap: Record<string, Upstream> = {};
  const detailMap: Record<string, Upstream> = {};
  await Promise.all(
    devices.map(async (d: Upstream) => {
      const [stats, detail] = await Promise.all([
        safeFetch(`${prefix}/devices/${d.id}/statistics/latest`),
        safeFetch(`${prefix}/devices/${d.id}`),
      ]);
      if (stats) statsMap[d.id] = stats;
      if (detail) detailMap[d.id] = detail;
    }),
  );

  const classified: Upstream[] = devices.map((d: Upstream) => ({
    ...d,
    _role: classifyDevice(d),
  }));

  const gateway: Upstream = classified.find((d: Upstream) => d._role === 'gateway') || {};
  const gwStats: Upstream = statsMap[gateway.id] || {};
  const switches = classified.filter((d: Upstream) => d._role === 'switch');
  const aps = classified.filter((d: Upstream) => d._role === 'ap');

  const clientsByDeviceId: Record<string, number> = {};
  let wirelessCount = 0;
  let wiredCount = 0;
  let vpnCount = 0;
  for (const c of clients) {
    if (c.type === 'WIRELESS') wirelessCount++;
    else if (c.type === 'WIRED') wiredCount++;
    else if (c.type === 'VPN' || c.type === 'TELEPORT') vpnCount++;
    if (c.uplinkDeviceId) {
      clientsByDeviceId[c.uplinkDeviceId] = (clientsByDeviceId[c.uplinkDeviceId] || 0) + 1;
    }
  }

  const sortedClients = [...clients]
    .sort((a: Upstream, b: Upstream) => {
      const ta = a.connectedAt ? new Date(a.connectedAt).getTime() : 0;
      const tb = b.connectedAt ? new Date(b.connectedAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 10);

  const gwUplink = gwStats.uplink || {};
  const wanDownBps = gwUplink.rxRateBps || gwUplink.rx_rate_bps || 0;
  const wanUpBps = gwUplink.txRateBps || gwUplink.tx_rate_bps || 0;

  return {
    unifi: {
      gateway: {
        model: gateway.model || gateway.name || 'Unknown',
        cpu: gwStats.cpuUtilizationPct ?? gwStats.cpu_utilization_pct ?? 0,
        ram: gwStats.memoryUtilizationPct ?? gwStats.memory_utilization_pct ?? 0,
        tempC: gwStats.temperature ?? 0,
        uptime: formatUptime(gwStats.uptimeSec ?? gwStats.uptime_sec ?? 0),
        fwVersion: gateway.firmwareVersion || 'n/a',
      },
      switches: switches.map((s: Upstream) => {
        const sStats = statsMap[s.id] || {};
        const detail = detailMap[s.id] || {};
        const ports = detail.interfaces?.ports || [];
        const portsUp = ports.filter(
          (p: Upstream) => (p.state || '').toUpperCase() === 'UP',
        ).length;
        return {
          name: s.name || s.model || 'Switch',
          model: s.model || '',
          state: s.state || detail.state || 'UNKNOWN',
          poeUsedW: Math.round(sStats.poePortPower ?? sStats.poe_port_power ?? 0),
          poeMaxW: Math.round(sStats.poeBudget ?? sStats.poe_budget ?? 0),
          ports: ports.length,
          portsUp,
          portsActive: clientsByDeviceId[s.id] || 0,
        };
      }),
      aps: aps.map((ap: Upstream) => {
        const apDetail = detailMap[ap.id] || {};
        const radios = apDetail.interfaces?.radios || [];
        const primaryRadio = radios[0] || {};
        return {
          name: ap.name || ap.model || 'AP',
          model: ap.model || '',
          state: ap.state || apDetail.state || 'UNKNOWN',
          clients: clientsByDeviceId[ap.id] || 0,
          channel: primaryRadio.channel ? `${primaryRadio.channel}` : 'n/a',
          frequency: primaryRadio.frequencyGHz || null,
          airtime: 0,
          txMbps: 0,
        };
      }),
      clients: clients.length,
      clientBreakdown: { wireless: wirelessCount, wired: wiredCount, vpn: vpnCount },
      topTalkers: sortedClients.map((c: Upstream) => ({
        name: c.name || c.macAddress || 'unknown',
        ip: c.ipAddress || 'n/a',
        type: c.type || 'UNKNOWN',
        access: c.access?.type || 'DEFAULT',
        connectedAt: c.connectedAt || '',
        rxMB: 0,
        txMB: 0,
      })),
      wan: {
        down: Math.round(wanDownBps / 1_000_000),
        up: Math.round(wanUpBps / 1_000_000),
        downMax: 1000,
        upMax: 1000,
        public: gwStats.wanIp || gateway.ipAddress || 'n/a',
      },
      networks: networks.map((n: Upstream) => ({
        id: n.id,
        name: n.name || 'Unnamed',
        vlanId: n.vlanId ?? null,
        enabled: n.enabled ?? true,
        management: n.management || 'UNMANAGED',
        isDefault: n.default ?? false,
      })),
      ssids: ssids.map((s: Upstream) => ({
        id: s.id,
        name: s.name || 'Unnamed',
        enabled: s.enabled ?? true,
        security: s.securityConfiguration?.type || 'unknown',
        broadcastingFrequencies: s.broadcastingFrequenciesGhz || s.broadcastingFrequenciesGHz || [],
      })),
      firewall: {
        zones: fwZones.length,
        policies: fwPolicies.length,
        policiesEnabled: fwPolicies.filter((p: Upstream) => p.enabled).length,
      },
      vpnServers: vpnServers.map((v: Upstream) => ({
        id: v.id,
        name: v.name || 'VPN Server',
        type: v.type || 'unknown',
        enabled: v.enabled ?? true,
      })),
      dnsRecords: dnsRecords.map((r: Upstream) => ({
        id: r.id,
        type: r.type || 'unknown',
        domain: r.domain || '',
        enabled: r.enabled ?? true,
      })),
      appVersion,
    },
    network: {
      latencyMs: gwStats.latency ?? 0,
      speedtest: { down: 0, up: 0, ping: 0, when: 'n/a' },
      uptime30d: (gwStats.uptimeSec ?? gwStats.uptime_sec ?? 0) > 0 ? 99.9 : 0,
      publicIp: gwStats.wanIp || gateway.ipAddress || 'n/a',
      dns: [],
    },
  };
}

const fetchUnifiData = withTtlCache(fetchUnifiDataRaw, CACHE_TTL);

export const unifiStatus = {
  enabled: config.enabled,
  configured: config.enabled && !!(config.baseUrl && config.apiKey),
  hasKey: config.enabled && !!config.apiKey,
  baseUrl: config.baseUrl,
};

export function configureUnifi(next: UnifiRuntimeConfig): void {
  config = {
    enabled: next.enabled,
    baseUrl: next.baseUrl,
    apiKey: next.apiKey ?? '',
    site: next.site || 'default',
  };
  resolvedSiteId = null;
  fetchUnifiData.clear();
  unifiStatus.enabled = config.enabled;
  unifiStatus.configured = config.enabled && !!(config.baseUrl && config.apiKey);
  unifiStatus.hasKey = config.enabled && !!config.apiKey;
  unifiStatus.baseUrl = config.baseUrl;
}

/** Liveness probe used by /api/health/live. */
export function probeUnifi() {
  return uniFetch('/proxy/network/integration/v1/sites');
}

export function registerUnifi(app: Express) {
  app.get('/api/unifi', async (_req: Request, res: Response) => {
    if (!config.enabled) {
      return res.json({ disabled: true });
    }
    if (!config.baseUrl || !config.apiKey) {
      return res.status(503).json({
        error: 'UniFi not configured. Set base URL and API key in Setup, or UNIFI_API_KEY in env.',
      });
    }
    try {
      const data = await fetchUnifiData();
      res.json(data);
    } catch (err) {
      console.error('UniFi API error:', errorMessage(err));
      res.status(502).json({ error: errorMessage(err) });
    }
  });

  // Development-only raw passthrough for debugging UniFi API shapes.
  app.get('/api/debug', async (_req: Request, res: Response) => {
    if (!isDebugEndpointEnabled()) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!config.enabled) return res.status(503).json({ error: 'UniFi disabled' });
    if (!config.baseUrl || !config.apiKey) return res.status(503).json({ error: 'No API key' });
    try {
      const siteId = await getSiteId();
      const prefix = `/proxy/network/integration/v1/sites/${siteId}`;
      const devicesRes = await uniFetch(`${prefix}/devices?limit=50`);
      const clientsRes = await uniFetch(`${prefix}/clients?limit=5`);
      const allDevices = devicesRes.data || [];

      let deviceDetail = null;
      let deviceStats = null;
      if (allDevices.length > 0) {
        try {
          deviceDetail = await uniFetch(`${prefix}/devices/${allDevices[0].id}`);
        } catch {
          /* */
        }
        try {
          deviceStats = await uniFetch(`${prefix}/devices/${allDevices[0].id}/statistics/latest`);
        } catch {
          /* */
        }
      }

      let networks = null;
      try {
        networks = await uniFetch(`${prefix}/networks?limit=50`);
      } catch {
        /* */
      }
      let ssids = null;
      try {
        ssids = await uniFetch(`${prefix}/wifi/broadcasts?limit=50`);
      } catch {
        /* */
      }
      let wans = null;
      try {
        wans = await uniFetch(`${prefix}/wans?limit=50`);
      } catch {
        /* */
      }

      res.json({
        siteId,
        devices: { count: devicesRes.totalCount, items: allDevices },
        deviceDetail,
        deviceStats,
        clients: { count: clientsRes.totalCount, sample: (clientsRes.data || []).slice(0, 3) },
        networks,
        ssids,
        wans,
      });
    } catch (err) {
      res.status(502).json({ error: errorMessage(err) });
    }
  });
}
