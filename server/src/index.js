import 'dotenv/config';
import express from 'express';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Agent, fetch as undiciFetch, WebSocket as UndiciWebSocket } from 'undici';

import { initSiem } from './siem/index.js';
import { initState } from './state/index.js';
import { normalizeDiskParts } from './sensors/parse.js';
import { runRemote } from './lib/remote.js';
import { initSensors } from './sensors/index.js';

const execFileP = promisify(execFile);

// Homelab gear uses self-signed certs; skip TLS verification on these fetches only.
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
const insecureFetch = (url, opts = {}) =>
  undiciFetch(url, { ...opts, dispatcher: insecureDispatcher });

const app = express();
const PORT = Number(process.env.PORT) || 3001;

const FALSY_ENV = ['false', '0', 'no', 'off', 'disabled'];

function isEnabled(value, defaultEnabled = true) {
  // DISABLE_ALL is a master kill-switch: when truthy, every integration is
  // forced off regardless of its individual *_ENABLED flag. Useful for
  // smoke-testing the UI without any backend integrations configured.
  const disableAll = String(process.env.DISABLE_ALL || '').trim().toLowerCase();
  if (disableAll && !FALSY_ENV.includes(disableAll)) return false;
  if (value === undefined || value === null || value === '') return defaultEnabled;
  return !FALSY_ENV.includes(String(value).trim().toLowerCase());
}

function trimBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

const UNIFI_ENABLED = isEnabled(process.env.UNIFI_ENABLED);
const BASE_URL = process.env.UNIFI_BASE_URL;
if (UNIFI_ENABLED && !BASE_URL) {
  console.error('UNIFI_BASE_URL is not set. Add it to your .env file, or set UNIFI_ENABLED=false.');
  process.exit(1);
}
const API_KEY = process.env.UNIFI_API_KEY || '';
const SITE = process.env.UNIFI_SITE || 'default';
const CACHE_TTL = Number(process.env.UNIFI_POLL_INTERVAL) || 10000;

const PORTAINER_ENABLED = isEnabled(process.env.PORTAINER_ENABLED, false);
const PORTAINER_BASE_URL = trimBaseUrl(process.env.PORTAINER_BASE_URL);
const PORTAINER_API_KEY = process.env.PORTAINER_API_KEY || process.env.PORTAINER_TOKEN || '';
const PORTAINER_CACHE_TTL = Number(process.env.PORTAINER_POLL_INTERVAL) || 10000;
const PORTAINER_STATS_ENABLED = isEnabled(process.env.PORTAINER_STATS_ENABLED, true);

const PROXMOX_ENABLED = isEnabled(process.env.PROXMOX_ENABLED);
const PVE_BASE_URL = process.env.PROXMOX_BASE_URL;
const PVE_TOKEN_ID = process.env.PROXMOX_TOKEN_ID;
const PVE_TOKEN_SECRET = process.env.PROXMOX_TOKEN_SECRET;
const PVE_NODE_HINT = process.env.PROXMOX_NODE || '';
const PVE_CACHE_TTL = Number(process.env.PROXMOX_POLL_INTERVAL) || 5000;

const UNAS_ENABLED = isEnabled(process.env.UNAS_ENABLED, false);
const UNAS_BASE_URL = trimBaseUrl(process.env.UNAS_BASE_URL);
const UNAS_API_KEY = process.env.UNAS_API_KEY || '';
const UNAS_CACHE_TTL = Number(process.env.UNAS_POLL_INTERVAL) || 30000;

const PROTECT_ENABLED = isEnabled(process.env.PROTECT_ENABLED, false);
const PROTECT_BASE_URL = trimBaseUrl(process.env.PROTECT_BASE_URL);
const PROTECT_API_KEY = process.env.PROTECT_API_KEY || '';
const PROTECT_CACHE_TTL = Number(process.env.PROTECT_POLL_INTERVAL) || 10000;
const PROTECT_FFMPEG = process.env.PROTECT_FFMPEG || 'ffmpeg';
const PROTECT_STREAM_DIR =
  process.env.PROTECT_STREAM_DIR || path.join(os.tmpdir(), 'homelab-protect-streams');
const PROTECT_STREAM_IDLE_MS = Number(process.env.PROTECT_STREAM_IDLE_MS) || 30000;
const PROTECT_STREAM_QUALITY = (process.env.PROTECT_STREAM_QUALITY || 'medium').toLowerCase();
const PROTECT_RTSP_TRANSPORT = (process.env.PROTECT_RTSP_TRANSPORT || 'tcp').toLowerCase();
const PROTECT_EVENT_BUFFER = Number(process.env.PROTECT_EVENT_BUFFER) || 500;
const PROTECT_EVENTS_ENABLED = isEnabled(process.env.PROTECT_EVENTS_ENABLED, true);
// UniFi OS proxies app APIs at /proxy/<app>/...; standalone Protect appliances
// use /integration at the root — override PROTECT_API_PREFIX in that case.
const PROTECT_API_PREFIX = process.env.PROTECT_API_PREFIX || '/proxy/protect/integration';

const SIEM_ENABLED = isEnabled(process.env.SIEM_ENABLED, false);
const SIEM_PORT = Number(process.env.SIEM_PORT) || 514;
const SIEM_HOST = process.env.SIEM_HOST || '0.0.0.0';
const SIEM_DB_PATH = process.env.SIEM_DB_PATH
  ? path.resolve(process.env.SIEM_DB_PATH)
  : path.resolve(process.cwd(), 'data', 'siem.sqlite');
const SIEM_RETENTION_DAYS = Number(process.env.SIEM_RETENTION_DAYS) || 30;
const SIEM_MAX_PER_QUERY = Number(process.env.SIEM_MAX_PER_QUERY) || 1000;

const STATE_DB_PATH = process.env.STATE_DB_PATH
  ? path.resolve(process.env.STATE_DB_PATH)
  : path.resolve(process.cwd(), 'data', 'dashboard.sqlite');

let cache = { data: null, ts: 0 };

async function uniFetch(path) {
  const url = `${BASE_URL}${path}`;
  const res = await insecureFetch(url, {
    headers: {
      'X-API-Key': API_KEY,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UniFi API ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

function formatUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

async function fetchAllPages(basePath, limit = 200) {
  let all = [];
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

async function safeFetch(path) {
  try {
    return await uniFetch(path);
  } catch {
    return null;
  }
}

async function safeFetchAllPages(basePath, limit = 200) {
  try {
    return await fetchAllPages(basePath, limit);
  } catch {
    return [];
  }
}

let resolvedSiteId = null;

async function getSiteId() {
  if (resolvedSiteId) return resolvedSiteId;
  const res = await uniFetch('/proxy/network/integration/v1/sites');
  const sites = res.data || res;
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new Error('No sites found from UniFi API');
  }
  const site = sites.find(s => s.name === SITE || s.id === SITE) || sites[0];
  resolvedSiteId = site.id || site._id || site.name;
  return resolvedSiteId;
}

function hasFeature(d, name) {
  const f = d.features;
  if (Array.isArray(f)) return f.includes(name);
  if (f && typeof f === 'object') return f[name] !== undefined && f[name] !== null;
  return false;
}

function classifyDevice(d) {
  const model = (d.model || '').toLowerCase();

  const gwKeywords = ['ucg', 'udm', 'uxg', 'gateway', 'dream machine', 'cloud key'];
  if (gwKeywords.some(kw => model.includes(kw))) return 'gateway';

  const switchKeywords = ['usw', 'switch', 'us-', 'usp-'];
  const apKeywords = ['uap', 'u6', 'u7', 'nanohd', 'ac-pro', 'ac-lite', 'ap'];

  if (hasFeature(d, 'switching') || switchKeywords.some(kw => model.includes(kw))) {
    return 'switch';
  }

  if (hasFeature(d, 'accessPoint') || apKeywords.some(kw => model.includes(kw))) {
    return 'ap';
  }

  return 'other';
}

async function fetchUnifiData() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache.data;

  const siteId = await getSiteId();
  const prefix = `/proxy/network/integration/v1/sites/${siteId}`;

  const [devices, clients, networks, ssids, wans, fwZones, fwPolicies, vpnServers, dnsRecords] = await Promise.all([
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

  const statsMap = {};
  const detailMap = {};
  await Promise.all(devices.map(async (d) => {
    const [stats, detail] = await Promise.all([
      safeFetch(`${prefix}/devices/${d.id}/statistics/latest`),
      safeFetch(`${prefix}/devices/${d.id}`),
    ]);
    if (stats) statsMap[d.id] = stats;
    if (detail) detailMap[d.id] = detail;
  }));

  const classified = devices.map(d => ({ ...d, _role: classifyDevice(d) }));

  const gateway = classified.find(d => d._role === 'gateway') || {};
  const gwStats = statsMap[gateway.id] || {};
  const switches = classified.filter(d => d._role === 'switch');
  const aps = classified.filter(d => d._role === 'ap');

  const clientsByDeviceId = {};
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
    .sort((a, b) => {
      const ta = a.connectedAt ? new Date(a.connectedAt).getTime() : 0;
      const tb = b.connectedAt ? new Date(b.connectedAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 10);

  const gwUplink = gwStats.uplink || {};
  const wanDownBps = gwUplink.rxRateBps || gwUplink.rx_rate_bps || 0;
  const wanUpBps = gwUplink.txRateBps || gwUplink.tx_rate_bps || 0;

  const result = {
    unifi: {
      gateway: {
        model: gateway.model || gateway.name || 'Unknown',
        cpu: gwStats.cpuUtilizationPct ?? gwStats.cpu_utilization_pct ?? 0,
        ram: gwStats.memoryUtilizationPct ?? gwStats.memory_utilization_pct ?? 0,
        tempC: gwStats.temperature ?? 0,
        uptime: formatUptime(gwStats.uptimeSec ?? gwStats.uptime_sec ?? 0),
        fwVersion: gateway.firmwareVersion || 'n/a',
      },
      switches: switches.map(s => {
        const sStats = statsMap[s.id] || {};
        const detail = detailMap[s.id] || {};
        const ports = detail.interfaces?.ports || [];
        const portsUp = ports.filter(p => (p.state || '').toUpperCase() === 'UP').length;
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
      aps: aps.map(ap => {
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
      topTalkers: sortedClients.map(c => ({
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
      networks: networks.map(n => ({
        id: n.id,
        name: n.name || 'Unnamed',
        vlanId: n.vlanId ?? null,
        enabled: n.enabled ?? true,
        management: n.management || 'UNMANAGED',
        isDefault: n.default ?? false,
      })),
      ssids: ssids.map(s => ({
        id: s.id,
        name: s.name || 'Unnamed',
        enabled: s.enabled ?? true,
        security: s.securityConfiguration?.type || 'unknown',
        broadcastingFrequencies: s.broadcastingFrequenciesGhz || s.broadcastingFrequenciesGHz || [],
      })),
      firewall: {
        zones: fwZones.length,
        policies: fwPolicies.length,
        policiesEnabled: fwPolicies.filter(p => p.enabled).length,
      },
      vpnServers: vpnServers.map(v => ({
        id: v.id,
        name: v.name || 'VPN Server',
        type: v.type || 'unknown',
        enabled: v.enabled ?? true,
      })),
      dnsRecords: dnsRecords.map(r => ({
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

  cache = { data: result, ts: now };
  return result;
}

app.get('/api/unifi', async (_req, res) => {
  if (!UNIFI_ENABLED) {
    return res.json({ disabled: true });
  }
  if (!API_KEY) {
    return res.status(503).json({
      error: 'UNIFI_API_KEY not configured. Add it to your .env file.',
    });
  }
  try {
    const data = await fetchUnifiData();
    res.json(data);
  } catch (err) {
    console.error('UniFi API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    unifi: { enabled: UNIFI_ENABLED, configured: !!API_KEY, hasKey: !!API_KEY },
    portainer: {
      enabled: PORTAINER_ENABLED,
      configured: !!(PORTAINER_BASE_URL && PORTAINER_API_KEY),
    },
    proxmox: {
      enabled: PROXMOX_ENABLED,
      configured: !!(PVE_BASE_URL && PVE_TOKEN_ID && PVE_TOKEN_SECRET),
    },
    unas: {
      enabled: UNAS_ENABLED,
      configured: !!(UNAS_BASE_URL && UNAS_API_KEY),
    },
    protect: {
      enabled: PROTECT_ENABLED,
      configured: !!(PROTECT_BASE_URL && PROTECT_API_KEY),
    },
    gpu: {
      enabled: GPU_ENABLED,
      configured: GPU_MODE === 'local' || !!GPU_SSH_HOST,
    },
    sensors: {
      enabled: SENSORS_ENABLED,
      configured: SENSORS_MODE === 'local' || !!SENSORS_SSH_HOST,
    },
  });
});

const LIVE_HEALTH_CACHE_TTL_MS = Number(process.env.HEALTH_LIVE_CACHE_TTL) || 12000;
const LIVE_HEALTH_PROBE_TIMEOUT_MS = Number(process.env.HEALTH_LIVE_TIMEOUT) || 5000;
let liveHealthCache = { data: null, ts: 0 };

async function runProbe(name, configured, fn) {
  const checkedAt = new Date().toISOString();
  if (!configured) {
    return {
      name,
      status: 'skipped',
      ok: null,
      latencyMs: null,
      error: null,
      checkedAt,
    };
  }
  const start = Date.now();
  let timer;
  const timeoutP = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`probe timed out after ${LIVE_HEALTH_PROBE_TIMEOUT_MS}ms`)),
      LIVE_HEALTH_PROBE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([Promise.resolve().then(fn), timeoutP]);
    return {
      name,
      status: 'ok',
      ok: true,
      latencyMs: Date.now() - start,
      error: null,
      checkedAt,
    };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    return {
      name,
      status: 'down',
      ok: false,
      latencyMs: Date.now() - start,
      error: msg.slice(0, 300),
      checkedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

app.get('/api/health/live', async (req, res) => {
  const force = req.query.refresh === '1' || req.query.force === '1';
  const now = Date.now();
  if (!force && liveHealthCache.data && now - liveHealthCache.ts < LIVE_HEALTH_CACHE_TTL_MS) {
    res.set('Cache-Control', 'no-store');
    return res.json({
      ...liveHealthCache.data,
      fromCache: true,
      ageMs: now - liveHealthCache.ts,
      cacheTtlMs: LIVE_HEALTH_CACHE_TTL_MS,
    });
  }

  const probes = await Promise.all([
    runProbe(
      'unifi',
      UNIFI_ENABLED && !!BASE_URL && !!API_KEY,
      () => uniFetch('/proxy/network/integration/v1/sites'),
    ),
    runProbe(
      'portainer',
      PORTAINER_ENABLED && !!PORTAINER_BASE_URL && !!PORTAINER_API_KEY,
      () => portainerFetch('/api/endpoints', { timeoutMs: LIVE_HEALTH_PROBE_TIMEOUT_MS }),
    ),
    runProbe(
      'proxmox',
      PROXMOX_ENABLED && !!PVE_BASE_URL && !!PVE_TOKEN_ID && !!PVE_TOKEN_SECRET,
      () => pveFetch('/api2/json/version'),
    ),
    runProbe(
      'unas',
      UNAS_ENABLED && !!UNAS_BASE_URL && !!UNAS_API_KEY,
      () => unasFetch('/proxy/drive/api/v2/storage'),
    ),
    runProbe(
      'protect',
      PROTECT_ENABLED && !!PROTECT_BASE_URL && !!PROTECT_API_KEY,
      () => protectFetchJson('/v1/meta/info'),
    ),
    runProbe(
      'gpu',
      GPU_ENABLED && (GPU_MODE === 'local' || !!GPU_SSH_HOST),
      () => runNvidiaSmi(),
    ),
    runProbe(
      'sensors',
      SENSORS_ENABLED && (SENSORS_MODE === 'local' || !!SENSORS_SSH_HOST),
      () => sensorsHandle.runSensors(),
    ),
  ]);

  const byKey = {};
  for (const p of probes) byKey[p.name] = p;

  const summary = {
    total: probes.length,
    ok: probes.filter((p) => p.status === 'ok').length,
    down: probes.filter((p) => p.status === 'down').length,
    skipped: probes.filter((p) => p.status === 'skipped').length,
  };

  const result = {
    ok: summary.down === 0,
    checkedAt: new Date().toISOString(),
    summary,
    integrations: byKey,
  };
  liveHealthCache = { data: result, ts: now };
  res.set('Cache-Control', 'no-store');
  res.json({ ...result, fromCache: false, ageMs: 0, cacheTtlMs: LIVE_HEALTH_CACHE_TTL_MS });
});


let portainerCache = { data: null, ts: 0 };
let portainerLastError = null;

async function portainerFetch(path, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await insecureFetch(`${PORTAINER_BASE_URL}${path}`, {
      headers: {
        'X-API-Key': PORTAINER_API_KEY,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Portainer API ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function safePortainerFetch(path, fallback = null) {
  try {
    return await portainerFetch(path);
  } catch (err) {
    console.warn(`Portainer: ${path} failed → ${err.message}`);
    return fallback;
  }
}

function endpointId(endpoint) {
  return endpoint.Id ?? endpoint.ID ?? endpoint.id;
}

function endpointName(endpoint) {
  return endpoint.Name || endpoint.name || `Docker ${endpointId(endpoint)}`;
}

function endpointAddress(endpoint) {
  const raw =
    endpoint.PublicURL ||
    endpoint.URL ||
    endpoint.Url ||
    endpoint.EdgeID ||
    endpoint.EdgeId ||
    '';
  return String(raw).replace(/^tcp:\/\//, '').replace(/^https?:\/\//, '') || '—';
}

function endpointOnline(endpoint, dockerReachable) {
  const status = endpoint.Status ?? endpoint.status;
  if (dockerReachable) return true;
  if (typeof status === 'number') return status === 1;
  if (typeof status === 'string') return ['up', 'online', 'active', 'healthy'].includes(status.toLowerCase());
  return false;
}

function containerName(container) {
  const names = Array.isArray(container.Names) ? container.Names : [];
  return (names[0] || container.Name || container.Id || 'container').replace(/^\/+/, '');
}

function containerState(container) {
  const raw = String(container.State || container.Status || '').toLowerCase();
  if (raw.includes('pause')) return 'paused';
  if (raw.includes('running') || raw === 'up') return 'running';
  return 'stopped';
}

function containerStack(container) {
  const labels = container.Labels || {};
  return (
    labels['com.docker.compose.project'] ||
    labels['io.portainer.stack.name'] ||
    labels['com.docker.stack.namespace'] ||
    'standalone'
  );
}

function containerUptime(container) {
  if (containerState(container) !== 'running' || !container.Created) return '—';
  return formatUptime(Math.max(0, Math.floor(Date.now() / 1000) - Number(container.Created)));
}

function cpuPctFromStats(stats) {
  const cpuDelta =
    (stats?.cpu_stats?.cpu_usage?.total_usage || 0) -
    (stats?.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta =
    (stats?.cpu_stats?.system_cpu_usage || 0) -
    (stats?.precpu_stats?.system_cpu_usage || 0);
  const onlineCpus =
    stats?.cpu_stats?.online_cpus ||
    stats?.cpu_stats?.cpu_usage?.percpu_usage?.length ||
    1;
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return Math.max(0, (cpuDelta / systemDelta) * onlineCpus * 100);
}

function memMbFromStats(stats) {
  const usage = stats?.memory_stats?.usage || 0;
  const cache = stats?.memory_stats?.stats?.cache || 0;
  return Math.max(0, Math.round((usage - cache) / (1024 ** 2)));
}

async function containerStats(endpointIdValue, containerId) {
  if (!PORTAINER_STATS_ENABLED) return { cpu: 0, memMB: 0 };
  const stats = await safePortainerFetch(
    `/api/endpoints/${endpointIdValue}/docker/containers/${containerId}/stats?stream=false`,
    null,
  );
  if (!stats) return { cpu: 0, memMB: 0 };
  return {
    cpu: cpuPctFromStats(stats),
    memMB: memMbFromStats(stats),
  };
}

async function fetchEndpointDocker(endpoint) {
  const id = endpointId(endpoint);
  const [containers, info, version] = await Promise.all([
    safePortainerFetch(`/api/endpoints/${id}/docker/containers/json?all=true`, null),
    safePortainerFetch(`/api/endpoints/${id}/docker/info`, null),
    safePortainerFetch(`/api/endpoints/${id}/docker/version`, null),
  ]);

  const reachable = Array.isArray(containers);
  const mappedContainers = await Promise.all((containers || []).map(async (c) => {
    const state = containerState(c);
    const stats = state === 'running'
      ? await containerStats(id, c.Id)
      : { cpu: 0, memMB: 0 };
    return {
      name: containerName(c),
      host: String(id),
      image: c.Image || 'unknown',
      state,
      cpu: stats.cpu,
      memMB: stats.memMB,
      uptime: containerUptime(c),
      stack: containerStack(c),
    };
  }));

  const memTotal = info?.MemTotal || 0;
  const hostMemMb = mappedContainers.reduce((sum, c) => sum + c.memMB, 0);
  const hostRamPct = memTotal ? Math.round((hostMemMb * 1024 ** 2 / memTotal) * 100) : 0;
  const hostCpuPct = Math.round(mappedContainers.reduce((sum, c) => sum + c.cpu, 0) * 10) / 10;

  return {
    host: {
      id: String(id),
      name: endpointName(endpoint),
      addr: endpointAddress(endpoint),
      os: info?.OperatingSystem || info?.OSType || endpoint.Platform || 'Docker',
      engine: version?.Version || info?.ServerVersion || '—',
      cpu: hostCpuPct,
      ram: hostRamPct,
      status: endpointOnline(endpoint, reachable) ? 'online' : 'offline',
    },
    containers: mappedContainers,
  };
}

async function fetchPortainerDockerData() {
  const now = Date.now();
  if (portainerCache.data && now - portainerCache.ts < PORTAINER_CACHE_TTL) {
    return portainerCache.data;
  }

  const endpoints = await portainerFetch('/api/endpoints');
  const endpointList = Array.isArray(endpoints) ? endpoints : [];
  const dockerResults = await Promise.all(endpointList.map(fetchEndpointDocker));
  const hosts = dockerResults.map((r) => r.host);
  const containers = dockerResults.flatMap((r) => r.containers);
  const running = containers.filter((c) => c.state === 'running').length;
  const stopped = containers.filter((c) => c.state !== 'running').length;

  const result = {
    docker: {
      running,
      stopped,
      total: containers.length,
      updates: 0,
      hosts,
      containers,
    },
  };

  portainerCache = { data: result, ts: now };
  portainerLastError = null;
  return result;
}

app.get('/api/docker', async (_req, res) => {
  if (!PORTAINER_ENABLED) return res.json({ disabled: true });
  if (!PORTAINER_BASE_URL || !PORTAINER_API_KEY) {
    return res.status(503).json({
      error: 'Portainer not configured. Set PORTAINER_BASE_URL and PORTAINER_API_KEY in .env',
    });
  }
  try {
    const data = await fetchPortainerDockerData();
    res.json(data);
  } catch (err) {
    portainerLastError = err.message;
    console.error('Portainer API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/docker/debug', async (_req, res) => {
  if (!PORTAINER_ENABLED) return res.json({ disabled: true });
  res.json({
    config: {
      baseUrl: PORTAINER_BASE_URL || null,
      hasKey: !!PORTAINER_API_KEY,
      statsEnabled: PORTAINER_STATS_ENABLED,
    },
    cache: portainerCache.data
      ? {
        ageMs: Date.now() - portainerCache.ts,
        hosts: portainerCache.data.docker.hosts.length,
        containers: portainerCache.data.docker.containers.length,
      }
      : null,
    lastError: portainerLastError,
  });
});


let pveCache = { data: null, ts: 0 };

async function pveFetch(path) {
  const url = `${PVE_BASE_URL}${path}`;
  const res = await insecureFetch(url, {
    headers: {
      Authorization: `PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Proxmox API ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data;
}

async function safePveFetch(path) {
  try { return await pveFetch(path); }
  catch (err) {
    console.warn(`Proxmox: ${path} failed → ${err.message}`);
    return null;
  }
}

function mapVmState(s) {
  if (s === 'running') return 'running';
  if (s === 'paused' || s === 'suspended') return 'paused';
  return 'stopped';
}

function trimPveVersion(raw) {
  if (!raw) return 'n/a';
  // "pve-manager/9.1.6/71482d1833ded40a" → "9.1.6"
  const m = String(raw).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : String(raw);
}

function pickNodeIp(networks) {
  if (!Array.isArray(networks)) return null;
  const bridgeWithIp = networks.find(
    (n) => n.active && n.address && n.type === 'bridge'
  );
  if (bridgeWithIp) return bridgeWithIp.address;
  const anyWithIp = networks.find((n) => n.active && n.address);
  return anyWithIp ? anyWithIp.address : null;
}

async function getQemuIp(node, vmid) {
  // Requires qemu-guest-agent installed AND running inside the VM.
  const data = await safePveFetch(
    `/api2/json/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
  );
  if (!data?.result) return null;
  for (const iface of data.result) {
    if (iface.name === 'lo') continue;
    const addrs = iface['ip-addresses'] || [];
    const v4 = addrs.find(
      (a) => a['ip-address-type'] === 'ipv4' && !a['ip-address'].startsWith('127.'),
    );
    if (v4) return v4['ip-address'];
  }
  return null;
}

async function getLxcIp(node, vmid) {
  // Runtime IPs via /interfaces (only works while running).
  const ifaces = await safePveFetch(`/api2/json/nodes/${node}/lxc/${vmid}/interfaces`);
  if (Array.isArray(ifaces)) {
    for (const iface of ifaces) {
      if (iface.name === 'lo') continue;
      const ip = iface.inet || iface.inet6;
      if (ip) return String(ip).split('/')[0];
    }
  }
  // Fallback: parse static IP from /config (net0: ...,ip=198.51.100.30/24)
  const cfg = await safePveFetch(`/api2/json/nodes/${node}/lxc/${vmid}/config`);
  if (cfg) {
    for (const key of Object.keys(cfg)) {
      if (!key.startsWith('net')) continue;
      const m = String(cfg[key]).match(/ip=([\d.]+)/);
      if (m) return m[1];
    }
  }
  return null;
}

async function fetchProxmoxData() {
  const now = Date.now();
  if (pveCache.data && now - pveCache.ts < PVE_CACHE_TTL) return pveCache.data;

  const nodes = (await pveFetch('/api2/json/nodes')) || [];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('No Proxmox nodes returned');
  }

  const primary =
    nodes.find((n) => n.node === PVE_NODE_HINT) ||
    nodes.find((n) => n.status === 'online') ||
    nodes[0];

  const [nodeStatus, vmResources, storageList, networks, physicalDisks, zfsPools] = await Promise.all([
    safePveFetch(`/api2/json/nodes/${primary.node}/status`),
    safePveFetch('/api2/json/cluster/resources?type=vm'),
    safePveFetch(`/api2/json/nodes/${primary.node}/storage`),
    safePveFetch(`/api2/json/nodes/${primary.node}/network`),
    safePveFetch(`/api2/json/nodes/${primary.node}/disks/list`),
    safePveFetch(`/api2/json/nodes/${primary.node}/disks/zfs`),
  ]);

  const totalCores = nodes.reduce((sum, n) => sum + (n.maxcpu || 0), 0);
  const vms = Array.isArray(vmResources) ? vmResources : [];

  const runningVms = vms.filter((v) => v.status === 'running');
  const coresAllocated = runningVms.reduce((sum, v) => sum + (v.maxcpu || 0), 0);
  const ramAllocatedBytes = runningVms.reduce((sum, v) => sum + (v.maxmem || 0), 0);

  // QEMU IPs need qemu-guest-agent in the VM; without it we just return null.
  const vmIps = {};
  await Promise.all(
    runningVms.map(async (v) => {
      try {
        const ip =
          v.type === 'lxc'
            ? await getLxcIp(v.node, v.vmid)
            : await getQemuIp(v.node, v.vmid);
        if (ip) vmIps[v.vmid] = ip;
      } catch { /* ignore */ }
    }),
  );

  // Dedupe by storage name so shared pools aren't counted twice.
  const seenStorage = new Set();
  let storageUsed = 0;
  let storageTotal = 0;
  if (Array.isArray(storageList)) {
    for (const s of storageList) {
      if (!s.enabled || !s.active || !s.total) continue;
      if (seenStorage.has(s.storage)) continue;
      seenStorage.add(s.storage);
      storageUsed += s.used || 0;
      storageTotal += s.total || 0;
    }
  }

  const zfsHealthByName = new Map();
  if (Array.isArray(zfsPools)) {
    for (const z of zfsPools) {
      if (z?.name) zfsHealthByName.set(String(z.name), z.health || null);
    }
  }

  const memTotalBytes = nodeStatus?.memory?.total ?? primary.maxmem ?? 0;
  const memUsedBytes = nodeStatus?.memory?.used ?? primary.mem ?? 0;
  const memUsedPct = memTotalBytes ? (memUsedBytes / memTotalBytes) * 100 : 0;

  const cpuPct = (nodeStatus?.cpu ?? primary.cpu ?? 0) * 100;
  const uptimeSec = nodeStatus?.uptime ?? primary.uptime ?? 0;
  const pveVersion = trimPveVersion(nodeStatus?.pveversion || primary.level);
  const cpuModel = (nodeStatus?.cpuinfo?.model || 'Unknown CPU')
    .replace(/\s+\d+-Core Processor$/i, '')
    .replace(/\(R\)|\(TM\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cpuCores = nodeStatus?.cpuinfo?.cores || 0;
  const cpuThreads = nodeStatus?.cpuinfo?.cpus || primary.maxcpu || 0;

  const GB = 1024 ** 3;
  const TB = 1024 ** 4;

  const result = {
    proxmox: {
      nodes: nodes.length,
      node: {
        name: primary.node,
        ip: pickNodeIp(networks),
        cpu: cpuPct,
        ram: memUsedPct,
        ramUsedGB: memUsedBytes / GB,
        ramTotalGB: memTotalBytes / GB,
        ramAllocatedGB: ramAllocatedBytes / GB,
        cpuModel,
        cpuCores,
        cpuThreads,
        storageUsedTB: storageUsed / TB,
        storageTotalTB: storageTotal / TB,
        storagePct: storageTotal ? (storageUsed / storageTotal) * 100 : 0,
        uptime: formatUptime(uptimeSec),
        version: pveVersion,
      },
      vms: vms.map((v) => ({
        id: v.vmid,
        name: v.name || `vm-${v.vmid}`,
        type: v.type === 'lxc' ? 'LXC' : 'VM',
        state: mapVmState(v.status),
        cpu: (v.cpu || 0) * 100,
        ram: v.maxmem ? Math.round((v.mem / v.maxmem) * 100) : 0,
        disk: v.maxdisk ? Math.round(v.maxdisk / GB) : 0,
        ip: vmIps[v.vmid] || null,
      })),
      disks: (Array.isArray(physicalDisks) ? physicalDisks : []).map((d) => {
        const friendly = normalizeDiskParts(d);
        return {
          devpath: d.devpath || '',
          model: friendly.model,
          vendor: friendly.vendor,
          serial: d.serial || null,
          sizeBytes: Number(d.size) || 0,
          type: (d.type || 'unknown').toLowerCase(), // nvme | ssd | hdd | usb
          used: d.used || null,                       // "LVM", "ZFS", "partitions", null
          health: d.health || null,                   // "PASSED", "FAILED", "UNKNOWN"
          wearout: typeof d.wearout === 'number' ? d.wearout : null,
          rpm: Number(d.rpm) || 0,
        };
      }),
      storages: (Array.isArray(storageList) ? storageList : []).map((s) => {
        const zfsKey = String(s.pool || s.storage || '');
        return {
          name: s.storage || '',
          type: s.type || '',
          content: s.content || '',
          usedTB: (s.used || 0) / TB,
          totalTB: (s.total || 0) / TB,
          active: !!s.active,
          shared: !!s.shared,
          zfsHealth: zfsHealthByName.get(zfsKey) || zfsHealthByName.get(String(s.storage || '')) || null,
        };
      }),
      coresAllocated,
      coresTotal: totalCores,
    },
  };

  pveCache = { data: result, ts: now };
  return result;
}

app.get('/api/proxmox/debug', async (_req, res) => {
  if (!PROXMOX_ENABLED) return res.status(503).json({ error: 'Proxmox disabled' });
  if (!PVE_BASE_URL || !PVE_TOKEN_ID || !PVE_TOKEN_SECRET) {
    return res.status(503).json({ error: 'Proxmox not configured' });
  }
  const out = {};
  try { out.nodes = await pveFetch('/api2/json/nodes'); }
  catch (e) { out.nodesError = e.message; }
  const nodeName = PVE_NODE_HINT || out.nodes?.[0]?.node;
  if (nodeName) {
    try { out.nodeStatus = await pveFetch(`/api2/json/nodes/${nodeName}/status`); }
    catch (e) { out.nodeStatusError = e.message; }
  }
  try { out.clusterResources = await pveFetch('/api2/json/cluster/resources?type=vm'); }
  catch (e) { out.clusterResourcesError = e.message; }
  res.json(out);
});

app.get('/api/proxmox', async (_req, res) => {
  if (!PROXMOX_ENABLED) {
    return res.json({ disabled: true });
  }
  if (!PVE_BASE_URL || !PVE_TOKEN_ID || !PVE_TOKEN_SECRET) {
    return res.status(503).json({
      error: 'Proxmox not configured. Set PROXMOX_BASE_URL, PROXMOX_TOKEN_ID, PROXMOX_TOKEN_SECRET in .env',
    });
  }
  try {
    const data = await fetchProxmoxData();
    res.json(data);
  } catch (err) {
    console.error('Proxmox API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/debug', async (_req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ error: 'Not found' });
  }
  if (!UNIFI_ENABLED) return res.status(503).json({ error: 'UniFi disabled' });
  if (!API_KEY) return res.status(503).json({ error: 'No API key' });
  try {
    const siteId = await getSiteId();
    const prefix = `/proxy/network/integration/v1/sites/${siteId}`;
    const devicesRes = await uniFetch(`${prefix}/devices?limit=50`);
    const clientsRes = await uniFetch(`${prefix}/clients?limit=5`);
    const allDevices = devicesRes.data || [];

    let deviceDetail = null;
    let deviceStats = null;
    if (allDevices.length > 0) {
      try { deviceDetail = await uniFetch(`${prefix}/devices/${allDevices[0].id}`); } catch { /* */ }
      try { deviceStats = await uniFetch(`${prefix}/devices/${allDevices[0].id}/statistics/latest`); } catch { /* */ }
    }

    let networks = null;
    try { networks = await uniFetch(`${prefix}/networks?limit=50`); } catch { /* */ }
    let ssids = null;
    try { ssids = await uniFetch(`${prefix}/wifi/broadcasts?limit=50`); } catch { /* */ }
    let wans = null;
    try { wans = await uniFetch(`${prefix}/wans?limit=50`); } catch { /* */ }

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
    res.status(502).json({ error: err.message });
  }
});

const GPU_ENABLED = isEnabled(process.env.GPU_ENABLED);
const GPU_MODE = (process.env.GPU_MODE || 'ssh').toLowerCase();
const GPU_SSH_HOST = process.env.GPU_SSH_HOST || '';
const GPU_SSH_USER = process.env.GPU_SSH_USER || 'root';
const GPU_SSH_PORT = Number(process.env.GPU_SSH_PORT) || 22;
const GPU_SSH_KEY_PATH = process.env.GPU_SSH_KEY_PATH || '';
const GPU_CACHE_TTL = Number(process.env.GPU_POLL_INTERVAL) || 5000;

const NVIDIA_SMI_FIELDS = [
  'name',
  'utilization.gpu',
  'memory.used',
  'memory.total',
  'temperature.gpu',
  'power.draw',
  'power.limit',
  'fan.speed',
  'clocks.current.graphics',
  'clocks.current.memory',
].join(',');

let gpuCache = { data: null, ts: 0 };
let gpuLastError = null;

function runNvidiaSmi() {
  const queryArg = `--query-gpu=${NVIDIA_SMI_FIELDS}`;
  const formatArg = '--format=csv,noheader,nounits';
  return runRemote({
    mode: GPU_MODE,
    host: GPU_SSH_HOST,
    user: GPU_SSH_USER,
    port: GPU_SSH_PORT,
    keyPath: GPU_SSH_KEY_PATH,
    localCmd: 'nvidia-smi',
    localArgs: [queryArg, formatArg],
    remoteCmd: `nvidia-smi ${queryArg} ${formatArg}`,
  });
}

function parseNvidiaSmiCsv(output) {
  const lines = output.trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const p = line.split(',').map((s) => s.trim());
    const num = (i) => {
      const v = Number(p[i]);
      return Number.isFinite(v) ? v : 0;
    };
    return {
      name: p[0] || 'GPU',
      usage: num(1),
      memUsedMB: num(2),
      memTotalMB: num(3),
      tempC: num(4),
      powerW: num(5),
      powerMaxW: num(6),
      fanPct: num(7),
      gpuClockMHz: num(8),
      memClockMHz: num(9),
    };
  });
}

async function fetchGpuData() {
  const now = Date.now();
  if (gpuCache.data && now - gpuCache.ts < GPU_CACHE_TTL) return gpuCache.data;

  const output = await runNvidiaSmi();
  const gpus = parseNvidiaSmiCsv(output);
  if (gpus.length === 0) throw new Error('nvidia-smi returned no GPUs');

  const primary = gpus[0];
  const result = {
    gpu: {
      model: primary.name,
      usage: primary.usage,
      target: primary.usage,
      memUsedGB: primary.memUsedMB / 1024,
      memTotalGB: Math.round((primary.memTotalMB / 1024) * 10) / 10,
      tempC: primary.tempC,
      powerW: primary.powerW,
      powerMaxW: primary.powerMaxW,
      fanPct: primary.fanPct,
      gpuClockMHz: primary.gpuClockMHz,
      memClockMHz: primary.memClockMHz,
    },
    gpus,
  };

  gpuCache = { data: result, ts: now };
  gpuLastError = null;
  return result;
}

app.get('/api/gpu', async (_req, res) => {
  if (!GPU_ENABLED) return res.json({ disabled: true });
  if (GPU_MODE === 'ssh' && !GPU_SSH_HOST) {
    return res.status(503).json({ error: 'GPU_MODE=ssh but GPU_SSH_HOST is not set in .env' });
  }
  try {
    const data = await fetchGpuData();
    res.json(data);
  } catch (err) {
    gpuLastError = err.message;
    console.warn(`GPU: nvidia-smi failed (${GPU_MODE}) → ${err.message.split('\n')[0]}`);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/gpu/debug', async (_req, res) => {
  if (!GPU_ENABLED) return res.json({ disabled: true });
  const config = { mode: GPU_MODE };
  if (GPU_MODE === 'ssh') {
    config.host = GPU_SSH_HOST;
    config.user = GPU_SSH_USER;
    config.port = GPU_SSH_PORT;
    config.keyPath = GPU_SSH_KEY_PATH || '(default)';
  }
  res.json({
    config,
    cache: gpuCache.data ? { ageMs: Date.now() - gpuCache.ts, gpus: gpuCache.data.gpus } : null,
    lastError: gpuLastError,
  });
});

// Sensors share the GPU SSH config by default — both usually target the same host.

const SENSORS_ENABLED = isEnabled(process.env.SENSORS_ENABLED);
const SENSORS_MODE = (process.env.SENSORS_MODE || GPU_MODE).toLowerCase();
const SENSORS_SSH_HOST = process.env.SENSORS_SSH_HOST || GPU_SSH_HOST;
const SENSORS_SSH_USER = process.env.SENSORS_SSH_USER || GPU_SSH_USER;
const SENSORS_SSH_PORT = Number(process.env.SENSORS_SSH_PORT) || GPU_SSH_PORT;
const SENSORS_SSH_KEY_PATH = process.env.SENSORS_SSH_KEY_PATH || GPU_SSH_KEY_PATH;
const SENSORS_CACHE_TTL = Number(process.env.SENSORS_POLL_INTERVAL) || 5000;

const sensorsHandle = initSensors(app, {
  enabled: SENSORS_ENABLED,
  mode: SENSORS_MODE,
  sshHost: SENSORS_SSH_HOST,
  sshUser: SENSORS_SSH_USER,
  sshPort: SENSORS_SSH_PORT,
  sshKeyPath: SENSORS_SSH_KEY_PATH,
  cacheTtl: SENSORS_CACHE_TTL,
});


let unasCache = { data: null, ts: 0 };
let unasLastError = null;

async function unasFetch(path) {
  const res = await insecureFetch(`${UNAS_BASE_URL}${path}`, {
    headers: { 'X-API-Key': UNAS_API_KEY, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UNAS API ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function safeUnasFetch(path, fallback = null) {
  try {
    return await unasFetch(path);
  } catch (err) {
    console.warn(`UNAS: ${path} failed → ${err.message}`);
    return fallback;
  }
}

function formatRaidLevel(preferLevel) {
  if (!preferLevel) return 'JBOD';
  const m = String(preferLevel).match(/^raid(\d+)$/i);
  return m ? `RAID ${m[1]}` : String(preferLevel).toUpperCase();
}

function poolStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'fullyoperational' || s === 'optimal') return 'online';
  if (s.includes('degrade') || s.includes('rebuild') || s.includes('resync')) return 'degraded';
  return 'offline';
}

const UNAS_MODEL_NAMES = {
  UNAS2B: 'UNAS 2',
  UNAS2: 'UNAS 2',
  UNAS4B: 'UNAS 4',
  UNAS4: 'UNAS 4',
  UNASPRO: 'UNAS Pro',
  'UNAS-PRO': 'UNAS Pro',
};

function unasModelLabel(hardwareShort) {
  const code = String(hardwareShort || '').toUpperCase();
  if (!code) return 'UNAS';
  if (UNAS_MODEL_NAMES[code]) return UNAS_MODEL_NAMES[code];
  // Generic fallback for future models — e.g. "UNAS3B" → "UNAS 3B".
  return code.replace(/^UNAS[-_ ]?/, 'UNAS ').replace(/\s+/g, ' ').trim() || 'UNAS';
}

function diskSmart(disk) {
  const state = String(disk.state || '').toLowerCase();
  const risks = Array.isArray(disk.riskReasons) ? disk.riskReasons.length : 0;
  const badSectors = (Number(disk.badSectorCount) || 0) + (Number(disk.uncorrectableSectorCount) || 0);
  if (state !== 'optimal' || badSectors > 50) return 'bad';
  if (risks > 0 || badSectors > 0) return 'warn';
  return 'ok';
}

const INCOMPAT_LABELS = {
  DISK_INCOMPATIBLE_REASON_SMALLER_SIZE: 'smaller capacity',
  DISK_INCOMPATIBLE_REASON_LARGER_SIZE: 'larger than usable',
  DISK_INCOMPATIBLE_REASON_LOWER_RPM: 'slower RPM',
  DISK_INCOMPATIBLE_REASON_HIGHER_RPM: 'faster RPM',
  DISK_INCOMPATIBLE_REASON_DIFFERENT_MODEL: 'different model',
  DISK_INCOMPATIBLE_REASON_DIFFERENT_TYPE: 'different type',
};

function formatIncompatibility(code) {
  if (INCOMPAT_LABELS[code]) return INCOMPAT_LABELS[code];
  return String(code).replace(/^DISK_INCOMPATIBLE_REASON_/, '').toLowerCase().replace(/_/g, ' ');
}

const TB = 1024 ** 4;
const GB = 1024 ** 3;

async function fetchUnasData() {
  const now = Date.now();
  if (unasCache.data && now - unasCache.ts < UNAS_CACHE_TTL) return unasCache.data;

  const [storage, fanCtl, system] = await Promise.all([
    unasFetch('/proxy/drive/api/v2/storage'),
    safeUnasFetch('/proxy/drive/api/v2/systems/fan-control', null),
    safeUnasFetch('/api/system', null),
  ]);

  const rawPools = Array.isArray(storage?.pools) ? storage.pools : [];
  const rawDisks = Array.isArray(storage?.disks) ? storage.disks : [];

  const pools = rawPools.map((p) => {
    const incompatSet = new Set();
    for (const d of rawDisks) {
      if (d.poolId !== p.id) continue;
      for (const code of d.incompatibleReasons || []) incompatSet.add(code);
    }
    const scrub = p.dataScrubbing
      ? {
        status: p.dataScrubbing.status || 'unknown',
        scheduleEnabled: !!p.dataScrubbing.schedule?.enabled,
        lastRun: p.dataScrubbing.lastTaskRun || null,
        nextRun: p.dataScrubbing.nextRun || null,
      }
      : null;
    return {
      name: `Pool ${p.number ?? ''}`.trim() || 'Pool',
      type: formatRaidLevel(p.preferLevel),
      usedTB: (p.usage || 0) / TB,
      totalTB: (p.capacity || 0) / TB,
      status: poolStatus(p.status),
      scrub,
      incompatibilities: [...incompatSet].map(formatIncompatibility),
    };
  });

  const disks = rawDisks.map((d) => ({
    slot: String(d.slotId ?? '?'),
    model: String(d.model || 'unknown').trim(),
    tempC: Number(d.temperature) || 0,
    sizeGB: Math.round((Number(d.size) || 0) / GB),
    smart: diskSmart(d),
    powerOnHours: Number(d.powerOnHours) || 0,
    rpm: Number(d.rpm) || 0,
    badSectors: Number(d.badSectorCount) || 0,
    uncorrectableSectors: Number(d.uncorrectableSectorCount) || 0,
    lastSmartTest: d.smartTest
      ? {
        type: d.smartTest.type || 'unknown',
        status: d.smartTest.status || 'unknown',
        result: d.smartTest.result || 'unknown',
        finishedAt: d.smartTest.finishedAt || null,
      }
      : null,
  }));

  const maxDiskTemp = disks.reduce((m, d) => Math.max(m, d.tempC), 0);

  const modelLabel = unasModelLabel(system?.hardware?.shortname);

  const result = {
    unas: {
      name: system?.name || 'UNAS',
      model: modelLabel,
      tempC: maxDiskTemp,
      fanProfile: fanCtl?.currentProfile || '—',
      pools,
      disks,
    },
  };

  unasCache = { data: result, ts: now };
  unasLastError = null;
  return result;
}

app.get('/api/unas', async (_req, res) => {
  if (!UNAS_ENABLED) return res.json({ disabled: true });
  if (!UNAS_BASE_URL || !UNAS_API_KEY) {
    return res.status(503).json({
      error: 'UNAS not configured. Set UNAS_BASE_URL and UNAS_API_KEY in .env',
    });
  }
  try {
    res.json(await fetchUnasData());
  } catch (err) {
    unasLastError = err.message;
    console.error('UNAS API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/unas/debug', async (_req, res) => {
  if (!UNAS_ENABLED) return res.json({ disabled: true });
  res.json({
    config: { baseUrl: UNAS_BASE_URL || null, hasKey: !!UNAS_API_KEY },
    cache: unasCache.data
      ? {
        ageMs: Date.now() - unasCache.ts,
        pools: unasCache.data.unas.pools.length,
        disks: unasCache.data.unas.disks.length,
      }
      : null,
    lastError: unasLastError,
  });
});


let protectCache = { data: null, ts: 0 };
let protectLastError = null;

async function protectFetch(path, { accept = 'application/json', timeoutMs = 8000 } = {}) {
  const url = `${PROTECT_BASE_URL}${PROTECT_API_PREFIX}${path}`;
  let res;
  try {
    res = await insecureFetch(url, {
      headers: { 'X-API-Key': PROTECT_API_KEY, Accept: accept },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Protect API timeout (${timeoutMs}ms) — ${path}`);
    }
    throw new Error(`Protect API network error — ${path} — ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const preview = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(`Protect API ${res.status} ${res.statusText} — ${path} — ${preview}`);
  }
  return res;
}

async function protectFetchJson(path) {
  const res = await protectFetch(path);
  return res.json();
}

async function safeProtectFetchJson(path, fallback = null) {
  try {
    return await protectFetchJson(path);
  } catch (err) {
    console.warn(`Protect: ${path} failed → ${err.message}`);
    return fallback;
  }
}

// The Protect API encodes camera/nvr names as oneOf — sometimes a plain
// string, sometimes a wrapper object. Flatten to a string defensively.
function protectName(value, fallback = '—') {
  if (typeof value === 'string') return value || fallback;
  if (value && typeof value === 'object') {
    return value.name || value.value || value.text || fallback;
  }
  return fallback;
}

function mapProtectCamera(raw) {
  const flags = raw.featureFlags || {};
  const smart = raw.smartDetectSettings || {};
  return {
    id: String(raw.id || ''),
    name: protectName(raw.name, 'Camera'),
    modelKey: String(raw.modelKey || ''),
    mac: String(raw.mac || ''),
    state: String(raw.state || 'DISCONNECTED'),
    isMicEnabled: !!raw.isMicEnabled,
    micVolume: Number(raw.micVolume) || 0,
    videoMode: String(raw.videoMode || 'default'),
    hdrType: String(raw.hdrType || 'auto'),
    hasMic: !!flags.hasMic,
    hasSpeaker: !!flags.hasSpeaker,
    hasLedStatus: !!flags.hasLedStatus,
    hasHdr: !!flags.hasHdr,
    supportFullHdSnapshot: !!flags.supportFullHdSnapshot,
    hasPackageCamera: !!raw.hasPackageCamera,
    smartDetectTypes: Array.isArray(flags.smartDetectTypes) ? flags.smartDetectTypes : [],
    smartDetectAudioTypes: Array.isArray(flags.smartDetectAudioTypes) ? flags.smartDetectAudioTypes : [],
    enabledObjectTypes: Array.isArray(smart.objectTypes) ? smart.objectTypes : [],
    enabledAudioTypes: Array.isArray(smart.audioTypes) ? smart.audioTypes : [],
    osdName: !!raw.osdSettings?.isNameEnabled,
    osdDate: !!raw.osdSettings?.isDateEnabled,
    ledEnabled: !!raw.ledSettings?.isEnabled,
  };
}

function mapProtectNvr(raw) {
  if (!raw) return null;
  const arm = raw.armMode || {};
  return {
    id: String(raw.id || ''),
    name: protectName(raw.name, 'NVR'),
    modelKey: String(raw.modelKey || ''),
    armMode: {
      status: String(arm.status || 'disabled'),
      armProfileId: arm.armProfileId ?? null,
      armedAt: arm.armedAt ?? null,
      willBeArmedAt: arm.willBeArmedAt ?? null,
      breachDetectedAt: arm.breachDetectedAt ?? null,
      breachEventCount: Number(arm.breachEventCount) || 0,
    },
  };
}

async function fetchProtectData() {
  const now = Date.now();
  if (protectCache.data && now - protectCache.ts < PROTECT_CACHE_TTL) return protectCache.data;

  const [cameras, nvrs, info] = await Promise.all([
    protectFetchJson('/v1/cameras'),
    safeProtectFetchJson('/v1/nvrs', null),
    safeProtectFetchJson('/v1/meta/info', null),
  ]);

  // /v1/nvrs returns a single object (or sometimes an array — be lenient).
  const nvrRaw = Array.isArray(nvrs) ? nvrs[0] : nvrs;

  const cams = (Array.isArray(cameras) ? cameras : []).map(mapProtectCamera);
  const connected = cams.filter(c => c.state === 'CONNECTED').length;

  const result = {
    protect: {
      cameras: cams,
      total: cams.length,
      connected,
      disconnected: cams.length - connected,
      nvr: mapProtectNvr(nvrRaw),
      appVersion: info?.applicationVersion || null,
      // Fold 50 events into the main payload so the page renders without a second round-trip.
      recentEvents: listProtectEvents({ limit: 50 }),
      eventsConnected: !!protectWs && !!protectWsConnectedAt,
    },
  };

  protectCache = { data: result, ts: now };
  protectLastError = null;
  return result;
}

app.get('/api/protect', async (_req, res) => {
  if (!PROTECT_ENABLED) return res.json({ disabled: true });
  if (!PROTECT_BASE_URL || !PROTECT_API_KEY) {
    return res.status(503).json({
      error: 'Protect not configured. Set PROTECT_BASE_URL and PROTECT_API_KEY in .env',
    });
  }
  try {
    res.json(await fetchProtectData());
  } catch (err) {
    protectLastError = err.message;
    console.error('Protect API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Proxy snapshot bytes — browsers can't reach Protect directly (TLS + auth).
// Not cached server-side so client poll cadence drives freshness.
app.get('/api/protect/cameras/:id/snapshot', async (req, res) => {
  if (!PROTECT_ENABLED) return res.status(503).json({ error: 'Protect disabled' });
  if (!PROTECT_BASE_URL || !PROTECT_API_KEY) {
    return res.status(503).json({ error: 'Protect not configured' });
  }
  const id = String(req.params.id).replace(/[^a-zA-Z0-9-]/g, '');
  if (!id) return res.status(400).json({ error: 'Invalid camera id' });

  const params = new URLSearchParams();
  if (req.query.channel === 'package') params.set('channel', 'package');
  if (req.query.highQuality === 'true') params.set('highQuality', 'true');
  const qs = params.toString() ? `?${params}` : '';

  const t0 = Date.now();
  try {
    const upstream = await protectFetch(`/v1/cameras/${id}/snapshot${qs}`, {
      accept: 'image/jpeg',
      timeoutMs: 15000,
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) {
    // 503 maps to "camera offline" upstream; pass through cleanly.
    const msg = err.message || 'snapshot failed';
    const code = /\b503\b/.test(msg) ? 503 : /timeout/i.test(msg) ? 504 : 502;
    if (code !== 503) {
      console.warn(`Protect snapshot ${id} failed in ${Date.now() - t0}ms: ${msg}`);
    }
    res.status(code).json({ error: msg });
  }
});

// Protect WebSocket pushes motion/smartDetect/ring/sensor events as JSON
// { type: 'add'|'update'|'remove', item: {...} }. One persistent socket;
// events normalized and held in an in-memory ring buffer for REST polling.

const protectEvents = [];
let protectEventsSeq = 0;
let protectWs = null;
let protectWsRetryMs = 1000;
let protectWsLastError = null;
let protectWsConnectedAt = null;

function pushProtectEvent(raw) {
  const item = raw?.item;
  if (!item || typeof item !== 'object') return;
  if (raw.type === 'remove') return;

  // Flatten Protect's {text:"foo"} / {number:5} metadata wrappers.
  const metadata = {};
  if (item.metadata && typeof item.metadata === 'object') {
    for (const [k, v] of Object.entries(item.metadata)) {
      if (v && typeof v === 'object') {
        if ('text' in v) metadata[k] = v.text;
        else if ('number' in v) metadata[k] = v.number;
        else metadata[k] = v;
      } else {
        metadata[k] = v;
      }
    }
  }

  const evt = {
    seq: ++protectEventsSeq,
    action: String(raw.type || 'add'),
    id: String(item.id || ''),
    modelKey: String(item.modelKey || ''),
    type: String(item.type || 'unknown'),
    device: String(item.device || ''),
    start: Number(item.start) || Date.now(),
    end: item.end == null ? null : Number(item.end),
    smartDetectTypes: Array.isArray(item.smartDetectTypes) ? item.smartDetectTypes : [],
    metadata,
  };

  // Replace in place on `update` so end-times / smartDetect adds refresh the row,
  // preserving the original seq so the ordering doesn't jitter.
  const existing = protectEvents.findIndex((e) => e.id === evt.id);
  if (existing >= 0) {
    evt.seq = protectEvents[existing].seq;
    protectEvents[existing] = evt;
    return;
  }
  protectEvents.push(evt);
  while (protectEvents.length > PROTECT_EVENT_BUFFER) protectEvents.shift();
}

function decodeWsPayload(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return null;
}

function startProtectEventSubscriber() {
  if (!PROTECT_ENABLED || !PROTECT_EVENTS_ENABLED) return;
  if (!PROTECT_BASE_URL || !PROTECT_API_KEY) return;
  if (protectWs) return;

  const wsBase = PROTECT_BASE_URL.replace(/^http/i, 'ws');
  const url = `${wsBase}${PROTECT_API_PREFIX}/v1/subscribe/events`;

  let ws;
  try {
    ws = new UndiciWebSocket(url, {
      headers: { 'X-API-Key': PROTECT_API_KEY },
      dispatcher: insecureDispatcher,
    });
  } catch (err) {
    protectWsLastError = err.message;
    console.warn(`Protect events: WebSocket init failed → ${err.message}`);
    scheduleProtectReconnect();
    return;
  }

  protectWs = ws;
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    protectWsConnectedAt = Date.now();
    protectWsRetryMs = 1000;
    protectWsLastError = null;
    console.log(`Protect events: connected to ${url}`);
  });

  ws.addEventListener('message', (msgEvt) => {
    const text = decodeWsPayload(msgEvt.data);
    if (!text) return;
    let payload;
    try { payload = JSON.parse(text); } catch { return; }
    if (Array.isArray(payload)) payload.forEach(pushProtectEvent);
    else pushProtectEvent(payload);
  });

  ws.addEventListener('error', (errEvt) => {
    protectWsLastError = errEvt?.message || 'WebSocket error';
  });

  ws.addEventListener('close', (closeEvt) => {
    if (protectWs === ws) protectWs = null;
    protectWsConnectedAt = null;
    if (!shuttingDown) {
      const code = closeEvt?.code ?? '?';
      const reason = closeEvt?.reason ? ` "${closeEvt.reason}"` : '';
      const lastErr = protectWsLastError ? ` (last error: ${protectWsLastError})` : '';
      console.warn(
        `Protect events: disconnected ${code}${reason}${lastErr}; url=${url}; retry in ${protectWsRetryMs}ms`,
      );
      scheduleProtectReconnect();
    }
  });
}

let protectReconnectTimer = null;
function scheduleProtectReconnect() {
  if (protectReconnectTimer || shuttingDown) return;
  protectReconnectTimer = setTimeout(() => {
    protectReconnectTimer = null;
    protectWsRetryMs = Math.min(protectWsRetryMs * 2, 30000);
    startProtectEventSubscriber();
  }, protectWsRetryMs);
}

function listProtectEvents({ limit = 50, device = null, type = null, since = null } = {}) {
  let out = protectEvents;
  if (device) out = out.filter((e) => e.device === device);
  if (type) out = out.filter((e) => e.type === type);
  if (since != null) out = out.filter((e) => e.start >= since);
  return out.slice(-limit).reverse();
}

app.get('/api/protect/events', (req, res) => {
  if (!PROTECT_ENABLED) return res.json({ disabled: true });
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), PROTECT_EVENT_BUFFER);
  const device = req.query.device ? String(req.query.device) : null;
  const type = req.query.type ? String(req.query.type) : null;
  const since = req.query.since ? Number(req.query.since) : null;
  res.json({
    events: listProtectEvents({ limit, device, type, since }),
    connected: !!protectWs && !!protectWsConnectedAt,
    lastError: protectWsLastError,
    bufferSize: protectEvents.length,
    bufferLimit: PROTECT_EVENT_BUFFER,
  });
});

// Browsers can't play RTSPS; one ffmpeg per camera repackages to HLS into
// PROTECT_STREAM_DIR/<cameraId>. Sessions are shared across tabs and reaped
// after PROTECT_STREAM_IDLE_MS without a segment fetch.
const protectStreams = new Map();
let ffmpegAvailable = null;
let ffmpegVersionInfo = null;

async function detectFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    const { stdout } = await execFileP(PROTECT_FFMPEG, ['-version'], { timeout: 5000 });
    ffmpegVersionInfo = stdout.split('\n')[0] || '';
    ffmpegAvailable = true;
    console.log(`Protect streams: ${ffmpegVersionInfo}`);
  } catch (err) {
    ffmpegAvailable = false;
    ffmpegVersionInfo = `not found: ${err.message}`;
    console.warn(
      `Protect streams: ffmpeg not available at "${PROTECT_FFMPEG}". ` +
      `Install ffmpeg or set PROTECT_FFMPEG to its absolute path. Live video will be disabled.`,
    );
  }
  return ffmpegAvailable;
}

async function ensureRtspsUrl(cameraId, quality) {
  const existing = await safeProtectFetchJson(`/v1/cameras/${cameraId}/rtsps-stream`, null);
  if (existing && existing[quality]) return existing[quality];

  const res = await insecureFetch(
    `${PROTECT_BASE_URL}${PROTECT_API_PREFIX}/v1/cameras/${cameraId}/rtsps-stream`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': PROTECT_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ qualities: [quality] }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Protect RTSPS create failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const created = await res.json();
  if (!created[quality]) throw new Error(`Protect did not return a "${quality}" stream URL`);
  return created[quality];
}

function killStreamSession(cameraId, reason) {
  const session = protectStreams.get(cameraId);
  if (!session) return;
  protectStreams.delete(cameraId);
  try { session.proc?.kill('SIGKILL'); } catch { /* ignore */ }
  clearInterval(session.reaperId);
  rm(session.dir, { recursive: true, force: true }).catch(() => {});
  if (reason) console.log(`Protect stream ${cameraId} stopped: ${reason}`);
}

async function startStreamSession(cameraId, quality) {
  if (!ffmpegAvailable) throw new Error('ffmpeg is not available on the server');
  const id = String(cameraId).replace(/[^a-zA-Z0-9-]/g, '');
  if (!id) throw new Error('invalid camera id');

  const rtsps = await ensureRtspsUrl(id, quality);
  const dir = path.join(PROTECT_STREAM_DIR, id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const playlist = path.join(dir, 'index.m3u8');
  const segPattern = path.join(dir, 'seg-%05d.ts');

  // 2s segments, 6-segment window. Copy H.264 (Protect cams emit it natively); re-encode audio to AAC.
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', 'nobuffer',
    '-rtsp_transport', PROTECT_RTSP_TRANSPORT,
    '-i', rtsps,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', segPattern,
    '-hls_allow_cache', '0',
    playlist,
  ];

  const proc = spawn(PROTECT_FFMPEG, args, { windowsHide: true });
  const session = {
    id,
    quality,
    rtsps,
    dir,
    proc,
    startedAt: Date.now(),
    lastAccess: Date.now(),
    playlistReady: false,
    lastError: null,
    reaperId: null,
  };

  proc.stderr.on('data', (chunk) => {
    const line = String(chunk).trim();
    if (/error|failed|denied|forbidden|unauthorized/i.test(line)) {
      session.lastError = line.slice(0, 240);
    }
  });
  proc.on('exit', (code, signal) => {
    if (protectStreams.get(id) === session) {
      console.warn(`Protect stream ${id} ffmpeg exited (code=${code}, signal=${signal})`);
      killStreamSession(id, `ffmpeg exited ${code ?? signal}`);
    }
  });

  const readyTimer = setInterval(async () => {
    try {
      await readFile(playlist);
      session.playlistReady = true;
      clearInterval(readyTimer);
    } catch { /* not yet */ }
  }, 250);
  setTimeout(() => clearInterval(readyTimer), 12000);

  session.reaperId = setInterval(() => {
    if (Date.now() - session.lastAccess > PROTECT_STREAM_IDLE_MS) {
      killStreamSession(id, 'idle');
    }
  }, 5000);

  protectStreams.set(id, session);
  console.log(`Protect stream ${id} started (quality=${quality})`);
  return session;
}

async function waitForPlaylist(session, timeoutMs = 8000) {
  if (session.playlistReady) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (session.playlistReady) return true;
    if (session.lastError) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return session.playlistReady;
}

app.post('/api/protect/cameras/:id/stream/start', async (req, res) => {
  if (!PROTECT_ENABLED) return res.status(503).json({ error: 'Protect disabled' });
  if (!PROTECT_BASE_URL || !PROTECT_API_KEY) {
    return res.status(503).json({ error: 'Protect not configured' });
  }
  const id = String(req.params.id).replace(/[^a-zA-Z0-9-]/g, '');
  if (!id) return res.status(400).json({ error: 'invalid camera id' });

  if ((await detectFfmpeg()) === false) {
    return res.status(503).json({
      error: 'ffmpeg not available on server',
      hint: 'Install ffmpeg and ensure it is on PATH, or set PROTECT_FFMPEG to its absolute path.',
      detail: ffmpegVersionInfo,
    });
  }

  const requested = String(req.query.quality || PROTECT_STREAM_QUALITY).toLowerCase();
  const quality = ['high', 'medium', 'low', 'package'].includes(requested) ? requested : 'medium';

  try {
    let session = protectStreams.get(id);
    if (!session || session.quality !== quality) {
      if (session) killStreamSession(id, 'quality change');
      session = await startStreamSession(id, quality);
    }
    session.lastAccess = Date.now();
    const ready = await waitForPlaylist(session);
    if (!ready) {
      const err = session.lastError || 'ffmpeg did not produce a playlist in time';
      return res.status(502).json({ error: err });
    }
    res.json({
      ok: true,
      cameraId: id,
      quality: session.quality,
      playlist: `/api/protect/cameras/${id}/stream/index.m3u8`,
    });
  } catch (err) {
    console.error(`Protect stream start (${id}):`, err.message);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/protect/cameras/:id/stream/stop', (req, res) => {
  if (!PROTECT_ENABLED) return res.status(503).json({ error: 'Protect disabled' });
  const id = String(req.params.id).replace(/[^a-zA-Z0-9-]/g, '');
  killStreamSession(id, 'client requested stop');
  res.json({ ok: true });
});

app.get('/api/protect/cameras/:id/stream/:file', (req, res) => {
  if (!PROTECT_ENABLED) return res.status(503).json({ error: 'Protect disabled' });
  const id = String(req.params.id).replace(/[^a-zA-Z0-9-]/g, '');
  const file = String(req.params.file);
  if (!id) return res.status(400).end();
  // Whitelist playlist + numbered segments only — prevents path traversal.
  if (!/^index\.m3u8$/.test(file) && !/^seg-\d{5}\.ts$/.test(file)) {
    return res.status(400).json({ error: 'invalid stream file' });
  }
  const session = protectStreams.get(id);
  if (!session) return res.status(404).json({ error: 'no active stream' });
  session.lastAccess = Date.now();
  const full = path.join(session.dir, file);
  res.setHeader(
    'Content-Type',
    file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
  );
  res.setHeader('Cache-Control', 'no-store');
  const stream = createReadStream(full);
  stream.on('error', () => res.status(404).end());
  stream.pipe(res);
});

app.get('/api/protect/streams', (_req, res) => {
  if (!PROTECT_ENABLED) return res.json({ disabled: true });
  const sessions = [...protectStreams.values()].map((s) => ({
    cameraId: s.id,
    quality: s.quality,
    startedAt: s.startedAt,
    lastAccess: s.lastAccess,
    playlistReady: s.playlistReady,
    lastError: s.lastError,
  }));
  res.json({
    ffmpegAvailable,
    ffmpegVersion: ffmpegVersionInfo,
    sessions,
  });
});

let shuttingDown = false;
function shutdownProtect() {
  shuttingDown = true;
  for (const id of [...protectStreams.keys()]) killStreamSession(id, 'shutdown');
  try { protectWs?.close(); } catch { /* ignore */ }
}
process.on('SIGINT', () => { shutdownProtect(); process.exit(0); });
process.on('SIGTERM', () => { shutdownProtect(); process.exit(0); });
process.on('exit', shutdownProtect);

app.get('/api/protect/debug', async (_req, res) => {
  if (!PROTECT_ENABLED) return res.json({ disabled: true });
  res.json({
    config: {
      baseUrl: PROTECT_BASE_URL || null,
      hasKey: !!PROTECT_API_KEY,
      pollMs: PROTECT_CACHE_TTL,
      streamQuality: PROTECT_STREAM_QUALITY,
      streamIdleMs: PROTECT_STREAM_IDLE_MS,
      ffmpeg: { command: PROTECT_FFMPEG, available: ffmpegAvailable, version: ffmpegVersionInfo },
      events: { enabled: PROTECT_EVENTS_ENABLED, bufferLimit: PROTECT_EVENT_BUFFER },
    },
    cache: protectCache.data
      ? {
        ageMs: Date.now() - protectCache.ts,
        cameras: protectCache.data.protect.cameras.length,
        connected: protectCache.data.protect.connected,
        nvr: protectCache.data.protect.nvr?.name || null,
      }
      : null,
    events: {
      connected: !!protectWs && !!protectWsConnectedAt,
      bufferSize: protectEvents.length,
      lastError: protectWsLastError,
    },
    streams: {
      active: protectStreams.size,
      ids: [...protectStreams.keys()],
    },
    lastError: protectLastError,
  });
});

// Persistent app-state DB (inventory, thresholds, tweaks, etc.). Core, always on.
const stateHandle = await initState(app, { dbPath: STATE_DB_PATH }).catch((err) => {
  console.error(`State: init failed - ${err.message}`);
  return { shutdown() {}, recordMetric() {} };
});
process.on('SIGINT', () => { try { stateHandle.shutdown(); } catch { /* ignore */ } });
process.on('SIGTERM', () => { try { stateHandle.shutdown(); } catch { /* ignore */ } });

// SIEM mounts UDP listener + SSE + REST routes on `app`. Must complete before app.listen.
const siemHandle = await initSiem(app, {
  enabled: SIEM_ENABLED,
  port: SIEM_PORT,
  host: SIEM_HOST,
  dbPath: SIEM_DB_PATH,
  retentionDays: SIEM_RETENTION_DAYS,
  maxPerQuery: SIEM_MAX_PER_QUERY,
}).catch((err) => {
  console.error(`SIEM: init failed - ${err.message}`);
  return { shutdown() {} };
});
process.on('SIGINT', () => { try { siemHandle.shutdown(); } catch { /* ignore */ } });
process.on('SIGTERM', () => { try { siemHandle.shutdown(); } catch { /* ignore */ } });

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Static SPA + fallback so client-side routes resolve on hard refresh.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
app.use(express.static(distDir, { index: false, maxAge: '1h' }));
app.get(/^\/(?!api\/|healthz).*/, (_req, res, next) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => err && next());
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard listening on http://0.0.0.0:${PORT}`);
  if (UNIFI_ENABLED) {
    console.log(`UniFi: enabled — ${BASE_URL}`);
    console.log(`UniFi API Key: ${API_KEY ? 'configured' : 'NO — add UNIFI_API_KEY to .env'}`);
  } else {
    console.log('UniFi: DISABLED (set UNIFI_ENABLED=true in .env to enable)');
  }
  if (PROXMOX_ENABLED) {
    const pveOk = !!(PVE_BASE_URL && PVE_TOKEN_ID && PVE_TOKEN_SECRET);
    console.log(`Proxmox: ${pveOk ? `enabled — ${PVE_BASE_URL}` : 'enabled but NOT configured — set PROXMOX_* in .env'}`);
  } else {
    console.log('Proxmox: DISABLED (set PROXMOX_ENABLED=true in .env to enable)');
  }
  if (PORTAINER_ENABLED) {
    const portainerOk = !!(PORTAINER_BASE_URL && PORTAINER_API_KEY);
    console.log(`Portainer: ${portainerOk ? `enabled — ${PORTAINER_BASE_URL}` : 'enabled but NOT configured — set PORTAINER_* in .env'}`);
  } else {
    console.log('Portainer: DISABLED (set PORTAINER_ENABLED=true in .env to enable)');
  }
  if (UNAS_ENABLED) {
    const unasOk = !!(UNAS_BASE_URL && UNAS_API_KEY);
    console.log(`UNAS: ${unasOk ? `enabled — ${UNAS_BASE_URL}` : 'enabled but NOT configured — set UNAS_* in .env'}`);
  } else {
    console.log('UNAS: DISABLED (set UNAS_ENABLED=true in .env to enable)');
  }
  if (PROTECT_ENABLED) {
    const protectOk = !!(PROTECT_BASE_URL && PROTECT_API_KEY);
    console.log(`Protect: ${protectOk ? `enabled — ${PROTECT_BASE_URL}` : 'enabled but NOT configured — set PROTECT_* in .env'}`);
    if (protectOk) {
      // Detect ffmpeg in the background; failure just disables live video.
      detectFfmpeg().catch(() => {});
      startProtectEventSubscriber();
    }
  } else {
    console.log('Protect: DISABLED (set PROTECT_ENABLED=true in .env to enable)');
  }
  if (GPU_ENABLED) {
    if (GPU_MODE === 'local') {
      console.log('GPU: enabled — local nvidia-smi');
    } else if (GPU_SSH_HOST) {
      console.log(`GPU: enabled — ssh ${GPU_SSH_USER}@${GPU_SSH_HOST}:${GPU_SSH_PORT}`);
    } else {
      console.log('GPU: enabled but NOT configured — set GPU_SSH_HOST or GPU_MODE=local in .env');
    }
  } else {
    console.log('GPU: DISABLED (set GPU_ENABLED=true in .env to enable)');
  }
  if (SENSORS_ENABLED) {
    if (SENSORS_MODE === 'local') {
      console.log('Sensors: enabled — local sensors -j');
    } else if (SENSORS_SSH_HOST) {
      console.log(`Sensors: enabled — ssh ${SENSORS_SSH_USER}@${SENSORS_SSH_HOST}:${SENSORS_SSH_PORT}`);
    } else {
      console.log('Sensors: enabled but NOT configured — set SENSORS_SSH_HOST/GPU_SSH_HOST or SENSORS_MODE=local in .env');
    }
  } else {
    console.log('Sensors: DISABLED (set SENSORS_ENABLED=true in .env to enable)');
  }
  if (SIEM_ENABLED) {
    console.log(`SIEM: enabled — UDP ${SIEM_HOST}:${SIEM_PORT}, db ${SIEM_DB_PATH}, retention ${SIEM_RETENTION_DAYS}d`);
  } else {
    console.log('SIEM: DISABLED (set SIEM_ENABLED=true in .env to enable syslog ingestion on UDP 514)');
  }
  console.log(`State: db ${STATE_DB_PATH}`);
});
