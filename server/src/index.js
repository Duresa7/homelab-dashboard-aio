import 'dotenv/config';
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Agent, fetch as undiciFetch } from 'undici';

const execFileP = promisify(execFile);

// Homelab gear (UniFi, Proxmox, Portainer) typically uses self-signed certs.
// This dispatcher skips TLS verification for those specific fetches only —
// other outbound HTTPS calls from this process keep verifying normally.
// We use undici's fetch directly so the Agent matches its dispatcher type.
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
const insecureFetch = (url, opts = {}) =>
  undiciFetch(url, { ...opts, dispatcher: insecureDispatcher });

const app = express();
const PORT = Number(process.env.PORT) || 3001;

function isEnabled(value, defaultEnabled = true) {
  if (value === undefined || value === null || value === '') return defaultEnabled;
  return !['false', '0', 'no', 'off', 'disabled'].includes(String(value).trim().toLowerCase());
}

function trimBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

// ─── UniFi config ─────────────────────────────────────────────
const UNIFI_ENABLED = isEnabled(process.env.UNIFI_ENABLED);
const BASE_URL = process.env.UNIFI_BASE_URL;
if (UNIFI_ENABLED && !BASE_URL) {
  console.error('UNIFI_BASE_URL is not set. Add it to your .env file, or set UNIFI_ENABLED=false.');
  process.exit(1);
}
const API_KEY = process.env.UNIFI_API_KEY || '';
const SITE = process.env.UNIFI_SITE || 'default';
const CACHE_TTL = Number(process.env.UNIFI_POLL_INTERVAL) || 10000;

// ─── Portainer config ─────────────────────────────────────────
const PORTAINER_ENABLED = isEnabled(process.env.PORTAINER_ENABLED, false);
const PORTAINER_BASE_URL = trimBaseUrl(process.env.PORTAINER_BASE_URL);
const PORTAINER_API_KEY = process.env.PORTAINER_API_KEY || process.env.PORTAINER_TOKEN || '';
const PORTAINER_CACHE_TTL = Number(process.env.PORTAINER_POLL_INTERVAL) || 10000;
const PORTAINER_STATS_ENABLED = isEnabled(process.env.PORTAINER_STATS_ENABLED, true);

// ─── Proxmox config ───────────────────────────────────────────
const PROXMOX_ENABLED = isEnabled(process.env.PROXMOX_ENABLED);
const PVE_BASE_URL = process.env.PROXMOX_BASE_URL;
const PVE_TOKEN_ID = process.env.PROXMOX_TOKEN_ID;
const PVE_TOKEN_SECRET = process.env.PROXMOX_TOKEN_SECRET;
const PVE_NODE_HINT = process.env.PROXMOX_NODE || '';
const PVE_CACHE_TTL = Number(process.env.PROXMOX_POLL_INTERVAL) || 5000;

// ─── UNAS Pro config ──────────────────────────────────────────
const UNAS_ENABLED = isEnabled(process.env.UNAS_ENABLED, false);
const UNAS_BASE_URL = trimBaseUrl(process.env.UNAS_BASE_URL);
const UNAS_API_KEY = process.env.UNAS_API_KEY || '';
const UNAS_CACHE_TTL = Number(process.env.UNAS_POLL_INTERVAL) || 30000;

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
  console.log(`Resolved site: "${site.name}" → ID: ${resolvedSiteId}`);
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

  console.log(`Fetched ${devices.length} devices, ${clients.length} clients, ${networks.length} networks, ${ssids.length} SSIDs`);

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
  if (!cache.data) {
    classified.forEach(d => {
      const detail = detailMap[d.id];
      const portCount = detail?.interfaces?.ports?.length || 0;
      console.log(`  ${d._role.toUpperCase()}: "${d.name || '(no name)'}" model="${d.model}" ports=${portCount}`);
    });
  }

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

  if (Object.keys(gwStats).length > 0 && !cache.data) {
    console.log('Gateway stats keys:', Object.keys(gwStats).join(', '));
  }

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
    unifi: { enabled: UNIFI_ENABLED, hasKey: !!API_KEY },
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
  });
});

// ---------------------------------------------------------------------------
// Docker via Portainer
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Proxmox VE
// ---------------------------------------------------------------------------

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
  // Prefer an active bridge with an address; fall back to any iface with an address.
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

  // Resolve runtime IPs for running guests in parallel.
  // LXC IPs come from /interfaces or static config. QEMU IPs require
  // qemu-guest-agent in the VM; VMs without it just return null.
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

  // Storage: dedupe by `storage` name; sum the unique pools so a shared pool isn't double-counted.
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

// ---------------------------------------------------------------------------
// GPU (NVIDIA via SSH + nvidia-smi)
// ---------------------------------------------------------------------------

const GPU_ENABLED = isEnabled(process.env.GPU_ENABLED);
// GPU_MODE: "local" (run nvidia-smi here) or "ssh" (run it on a remote host).
// Use "local" when the dashboard runs on a machine with the GPU (e.g. an LXC
// with passthrough on the Proxmox host). Use "ssh" otherwise.
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

async function runRemote({ mode, host, user, port, keyPath, localCmd, localArgs, remoteCmd, timeoutMs = 8000 }) {
  if (mode === 'local') {
    const { stdout } = await execFileP(localCmd, localArgs, { timeout: timeoutMs });
    return stdout;
  }
  const sshArgs = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=5',
    '-p', String(port),
  ];
  if (keyPath) sshArgs.push('-i', keyPath);
  sshArgs.push(`${user}@${host}`, remoteCmd);
  const { stdout } = await execFileP('ssh', sshArgs, { timeout: timeoutMs });
  return stdout;
}

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

// ---------------------------------------------------------------------------
// Host sensors (lm-sensors: CPU temps, drive temps, fans, chipset)
// Shares the GPU SSH config by default since both target the same host.
// ---------------------------------------------------------------------------

const SENSORS_ENABLED = isEnabled(process.env.SENSORS_ENABLED);
const SENSORS_MODE = (process.env.SENSORS_MODE || GPU_MODE).toLowerCase();
const SENSORS_SSH_HOST = process.env.SENSORS_SSH_HOST || GPU_SSH_HOST;
const SENSORS_SSH_USER = process.env.SENSORS_SSH_USER || GPU_SSH_USER;
const SENSORS_SSH_PORT = Number(process.env.SENSORS_SSH_PORT) || GPU_SSH_PORT;
const SENSORS_SSH_KEY_PATH = process.env.SENSORS_SSH_KEY_PATH || GPU_SSH_KEY_PATH;
const SENSORS_CACHE_TTL = Number(process.env.SENSORS_POLL_INTERVAL) || 5000;

let sensorsCache = { data: null, ts: 0 };
let sensorsLastError = null;

function runSensorsRemote(localCmd, localArgs, remoteCmd) {
  return runRemote({
    mode: SENSORS_MODE,
    host: SENSORS_SSH_HOST,
    user: SENSORS_SSH_USER,
    port: SENSORS_SSH_PORT,
    keyPath: SENSORS_SSH_KEY_PATH,
    localCmd,
    localArgs,
    remoteCmd,
  });
}

function runSensors() {
  return runSensorsRemote('sensors', ['-j'], 'sensors -j');
}

function runLsblk() {
  const cols = 'NAME,PATH,MODEL,VENDOR,SERIAL,TRAN,TYPE';
  return runSensorsRemote('lsblk', ['-J', '-o', cols], `lsblk -J -o ${cols}`);
}

function cleanDiskPart(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUsefulDiskPart(value) {
  const cleaned = cleanDiskPart(value);
  return /^(unknown|n\/a|none|null|-+)$/i.test(cleaned) ? '' : cleaned;
}

function diskToken(...parts) {
  return parts
    .map(cleanUsefulDiskPart)
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Render a gigabyte count as a friendly capacity. 1000 GB and up collapses to TB.
function capacityFromGb(gb) {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1000) {
    const tb = n / 1000;
    return Number.isInteger(tb) ? `${tb}TB` : `${tb.toFixed(1)}TB`;
  }
  return `${n}GB`;
}

// Western Digital capacity is encoded in the digits right after "WD".
// 2-digit: WD80 → 80/10 = 8TB. 3-digit: WD120 → 120/10 = 12TB.
// 4-digit: WD5000 → 5000/10 = 500GB (sub-TB drives).
function wdCapacityFromDigits(digits) {
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (digits.length >= 4) {
    const gb = n / 10;
    return Number.isInteger(gb) ? `${gb}GB` : `${gb.toFixed(0)}GB`;
  }
  const tb = n / 10;
  return Number.isInteger(tb) ? `${tb}TB` : `${tb.toFixed(1)}TB`;
}

// WD's 4-letter family code identifies the drive line (Red, Blue, …).
// Codes are read from the suffix that immediately follows the capacity digits.
const WD_FAMILY = {
  // Red — CMR NAS HDD (consumer)
  EFRX: 'Red', EFAX: 'Red', EFGX: 'Red',
  // Red Plus — newer Red CMR drives
  EFBX: 'Red Plus', EFPX: 'Red Plus', EFZX: 'Red Plus', EFZZ: 'Red Plus',
  // Red Pro — high-throughput NAS
  FFBX: 'Red Pro', KFGX: 'Red Pro', PFBX: 'Red Pro',
  // Blue — consumer desktop
  EZRZ: 'Blue', EZEX: 'Blue', AZLW: 'Blue', AZLX: 'Blue', AZRZ: 'Blue', AZBX: 'Blue',
  // Black — performance desktop
  FZWX: 'Black', LSAX: 'Black SN', LSBX: 'Black SN', PLAX: 'Black SN850',
  // Purple — surveillance
  PURX: 'Purple', PURZ: 'Purple', PURP: 'Purple Pro',
  // Gold — enterprise / datacenter
  FRYZ: 'Gold', VRYZ: 'Gold',
  // Green — older low-power
  EZRS: 'Green', AZRX: 'Green',
};

// Seagate consumer / NAS models use a 2-letter family code right after the
// capacity-in-GB digits. e.g. ST4000VN008 → "VN" → IronWolf 4 TB.
const SEAGATE_FAMILY = {
  VN: 'IronWolf',          // NAS
  NE: 'IronWolf Pro',
  NT: 'IronWolf Pro',
  DM: 'BarraCuda',         // desktop 3.5"
  LM: 'BarraCuda',         // 2.5" laptop
  GX: 'FireCuda',
  LX: 'FireCuda',
  NM: 'Exos',              // enterprise
  VX: 'SkyHawk',           // surveillance
  AS: 'BarraCuda',
};

// Crucial CT-prefix models follow the pattern CT<capacityGB><family>SSD<rev>.
const CRUCIAL_FAMILY = {
  P3P:   { label: 'P3 Plus',  bus: 'NVMe' },
  P5P:   { label: 'P5 Plus',  bus: 'NVMe' },
  P3:    { label: 'P3',       bus: 'NVMe' },
  P5:    { label: 'P5',       bus: 'NVMe' },
  P1:    { label: 'P1',       bus: 'NVMe' },
  P2:    { label: 'P2',       bus: 'NVMe' },
  T700:  { label: 'T700',     bus: 'NVMe' },
  T705:  { label: 'T705',     bus: 'NVMe' },
  T500:  { label: 'T500',     bus: 'NVMe' },
  MX500: { label: 'MX500',    bus: 'SATA' },
  MX300: { label: 'MX300',    bus: 'SATA' },
  MX200: { label: 'MX200',    bus: 'SATA' },
  BX500: { label: 'BX500',    bus: 'SATA' },
  BX300: { label: 'BX300',    bus: 'SATA' },
  BX200: { label: 'BX200',    bus: 'SATA' },
  M4:    { label: 'M4',       bus: 'SATA' },
};
const CRUCIAL_FAMILY_REGEX = new RegExp(
  // Ordered longest-first so "P3P" beats "P3" and "MX500" beats "MX".
  'CT(\\d+)(' +
    Object.keys(CRUCIAL_FAMILY)
      .sort((a, b) => b.length - a.length)
      .join('|') +
    ')SSD\\d?',
);

function detectCrucial(token) {
  const m = token.match(CRUCIAL_FAMILY_REGEX);
  if (!m) return null;
  const sizeGb = Number(m[1]);
  const fam = CRUCIAL_FAMILY[m[2]];
  if (!fam) return null;
  const kind = fam.bus === 'NVMe' ? 'NVMe SSD' : 'SATA SSD';
  return {
    vendor: 'Crucial',
    model: [fam.label, capacityFromGb(sizeGb), kind].filter(Boolean).join(' '),
  };
}

function detectWesternDigital(token) {
  if (!/WD/.test(token)) return null;
  const m = token.match(/(?:WDC)?WD(\d{2,4})([A-Z]+)/);
  if (!m) return null;
  const capStr = wdCapacityFromDigits(m[1]);
  const suffix = m[2];

  let family = null;
  // The family code is 4 letters; it sometimes sits at the start of the
  // suffix, sometimes in the middle (next to revision letters). Scan.
  for (let i = 0; i + 4 <= suffix.length; i++) {
    const code = suffix.slice(i, i + 4);
    if (WD_FAMILY[code]) { family = WD_FAMILY[code]; break; }
  }

  if (!family) {
    // Heuristic fallback by suffix prefix when we can't pin a family.
    if (/^EF/.test(suffix)) family = 'Red';
    else if (/^EZ/.test(suffix)) family = 'Blue';
    else if (/^FZ/.test(suffix)) family = 'Black';
    else if (/^PUR/.test(suffix)) family = 'Purple';
  }

  return {
    vendor: 'Western Digital',
    model: [family, capStr].filter(Boolean).join(' ') || `WD ${capStr}`.trim(),
  };
}

function detectSeagate(token) {
  // ST<capacityGB><2-letter family><revision digits>
  const m = token.match(/ST(\d{3,5})([A-Z]{2})\d/);
  if (!m) return null;
  const gb = Number(m[1]);
  const family = SEAGATE_FAMILY[m[2]] || null;
  const capStr = capacityFromGb(gb);
  return {
    vendor: 'Seagate',
    model: [family, capStr].filter(Boolean).join(' ') || `Seagate ${capStr}`,
  };
}

function detectSamsung(token, rawModel) {
  if (!/SAMSUNG|^MZ[VN]|^MZQL/.test(token)) return null;
  // Consumer Samsung models usually carry a human-readable string in the
  // raw model field, e.g. "Samsung SSD 990 PRO 1TB". Strip the leading
  // "Samsung" / "SSD" so we don't double up the vendor.
  const cleaned = String(rawModel || '')
    .replace(/^samsung[\s_]*ssd[\s_]*/i, '')
    .replace(/^samsung[\s_]*/i, '')
    .trim();
  return { vendor: 'Samsung', model: cleaned || rawModel || '' };
}

function detectKingston(token, rawModel) {
  if (!/KINGSTON|^(KC|SKC|SA400|SNV|NV[12])/.test(token)) return null;
  const cleaned = String(rawModel || '')
    .replace(/^kingston[\s_]*/i, '')
    .trim();
  return { vendor: 'Kingston', model: cleaned || rawModel || '' };
}

function detectToshibaKioxia(token, rawModel) {
  if (!/TOSHIBA|KIOXIA|^MG\d|^MQ\d|^DT\d/.test(token)) return null;
  const isKioxia = /KIOXIA/.test(token);
  const cleaned = String(rawModel || '')
    .replace(/^toshiba[\s_]*/i, '')
    .replace(/^kioxia[\s_]*/i, '')
    .trim();
  return { vendor: isKioxia ? 'Kioxia' : 'Toshiba', model: cleaned || rawModel || '' };
}

function detectHgstHitachi(token, rawModel) {
  if (!/HITACHI|HGST|^HUS|^HDN/.test(token)) return null;
  const cleaned = String(rawModel || '').replace(/^(hitachi|hgst)[\s_]*/i, '').trim();
  return { vendor: 'HGST', model: cleaned || rawModel || '' };
}

function normalizeDiskParts(disk) {
  const rawModel = cleanUsefulDiskPart(disk?.model);
  const rawVendor = cleanUsefulDiskPart(disk?.vendor);
  // Strip useless bus-type-as-vendor values that some kernels report.
  const vendor = /^(ata|nvme|scsi|usb)$/i.test(rawVendor) ? '' : rawVendor;
  const token = diskToken(vendor, rawModel);

  const detected =
    detectCrucial(token) ||
    detectWesternDigital(token) ||
    detectSeagate(token) ||
    detectSamsung(token, rawModel) ||
    detectKingston(token, rawModel) ||
    detectToshibaKioxia(token, rawModel) ||
    detectHgstHitachi(token, rawModel);

  if (detected && detected.model) return detected;

  // No specific brand match — return the cleaned passthrough so the UI at
  // least shows something readable instead of "unknown".
  return { vendor, model: rawModel };
}

function diskDisplayName(disk) {
  const { model, vendor } = normalizeDiskParts(disk);
  if (!model) return vendor || null;
  if (!vendor || model.toLowerCase().includes(vendor.toLowerCase())) return model;
  return `${vendor} ${model}`;
}

// Map an lm-sensors chip key (e.g. "nct6687-isa-0a20") and the in-chip
// sensor name to a short, friendly label the UI can show as a sub-title.
// We never want to leak the raw chip identifier to users.
function friendlySystemSensorLabel(chipKey, sensorName) {
  const chip = String(chipKey || '').toLowerCase();
  const sensor = String(sensorName || '').trim();
  // Explicit PCH / chipset readings.
  if (/^(chipset|pch)$/i.test(sensor)) return 'Chipset';
  if (/^pch/i.test(chip)) return 'Chipset';
  // Super-IO / EC chips that report motherboard temps.
  if (/^(nct|it86|w836|f718|nuvoton|asus|ec_sys|asusec)/.test(chip)) {
    return 'Motherboard';
  }
  // Generic OS-level / ACPI source.
  if (chip.startsWith('acpitz') || chip.startsWith('thermal_zone')) return 'System';
  // Anything else — keep it generic rather than echoing chip/sensor IDs.
  return 'System';
}

function diskKind(disk) {
  const name = String(disk.name || '').toLowerCase();
  const path = String(disk.path || '').toLowerCase();
  const tran = String(disk.tran || '').toLowerCase();
  if (tran === 'nvme' || name.startsWith('nvme') || path.includes('/nvme')) return 'nvme';
  return 'sata';
}

function deviceShortName(path) {
  return String(path || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

function withUniqueDiskDisplayNames(disks) {
  const counts = disks.reduce((acc, d) => {
    acc.set(d.name, (acc.get(d.name) || 0) + 1);
    return acc;
  }, new Map());

  return disks.map((d, idx) => {
    if ((counts.get(d.name) || 0) <= 1) return d;
    const suffix = deviceShortName(d.path) || (d.serial ? String(d.serial).slice(-4) : `${idx + 1}`);
    return { ...d, name: `${d.name} (${suffix})` };
  });
}

async function fetchSensorDiskInventory() {
  try {
    const raw = await runLsblk();
    const json = JSON.parse(raw);
    const devices = Array.isArray(json.blockdevices) ? json.blockdevices : [];
    const disks = devices
      .filter((d) => d?.type === 'disk')
      .map((d) => ({
        kind: diskKind(d),
        name: diskDisplayName(d),
        path: d.path || (d.name ? `/dev/${d.name}` : null),
        serial: d.serial || null,
      }))
      .filter((d) => d.name);
    return withUniqueDiskDisplayNames(disks);
  } catch {
    return [];
  }
}

function diskNameQueues(inventory) {
  return inventory.reduce(
    (acc, d) => {
      acc[d.kind === 'nvme' ? 'nvme' : 'sata'].push(d.name);
      return acc;
    },
    { nvme: [], sata: [] },
  );
}

function findFirstNumeric(obj, predicate) {
  if (!obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && predicate(k)) return v;
  }
  return null;
}

function parseSensorsJson(raw, diskInventory = []) {
  // sensors output can include warnings on stderr; -j strips them, but be defensive
  const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const diskNames = diskNameQueues(diskInventory);

  let cpuTempC = null;
  let systemTempC = null;
  let systemTempLabel = null;
  let acpiTempC = null;
  let nvmeCount = 0;
  let dimmCount = 0;
  const cores = [];
  const disks = [];
  const memory = [];
  const network = [];
  const fans = [];
  const other = [];

  // Sensor names that motherboards / super-IO chips use to report the
  // overall "system" / "motherboard" temperature, in priority order.
  // Matched against each sensor's label (case-insensitive). First match wins.
  const SYSTEM_LABEL_PATTERNS = [
    // Tier 1: friendly names some BIOSes assign (Asus, Gigabyte, ASRock).
    /^systin$/i, /^mb[ _\-]?temp/i, /^motherboard$/i, /^board[ _\-]?temp/i,
    /^system$/i, /^chipset$/i, /^pch$/i,
    // Tier 2: MSI / Nuvoton nct668x conventions — the chip just calls the
    // motherboard's main board thermistor "Thermistor 0" or "Diode 0".
    /^thermistor[ _]*0$/i,
    /^diode[ _]*0/i,
  ];

  for (const [chipKey, chip] of Object.entries(json || {})) {
    if (!chip || typeof chip !== 'object') continue;

    const lcChip = chipKey.toLowerCase();

    // AMD Ryzen / Threadripper / EPYC: k10temp shows Tctl (control temp), Tdie, Tccd*
    if (lcChip.startsWith('k10temp') || lcChip.startsWith('zenpower')) {
      const tctl = findFirstNumeric(chip.Tctl, (k) => k.endsWith('_input'));
      const tdie = findFirstNumeric(chip.Tdie, (k) => k.endsWith('_input'));
      cpuTempC = tctl ?? tdie ?? cpuTempC;
      // Per-CCD temps if present
      for (const [k, v] of Object.entries(chip)) {
        if (/^Tccd\d+$/.test(k)) {
          const t = findFirstNumeric(v, (kk) => kk.endsWith('_input'));
          if (t != null) cores.push({ name: k, tempC: t });
        }
      }
      continue;
    }

    // Intel
    if (lcChip.startsWith('coretemp')) {
      for (const [sensorName, sensor] of Object.entries(chip)) {
        if (typeof sensor !== 'object') continue;
        const t = findFirstNumeric(sensor, (kk) => kk.endsWith('_input'));
        if (t == null) continue;
        if (/^Package/i.test(sensorName)) cpuTempC = t;
        else if (/^Core/i.test(sensorName)) cores.push({ name: sensorName, tempC: t });
      }
      continue;
    }

    // NVMe drives
    if (lcChip.startsWith('nvme')) {
      const composite = findFirstNumeric(chip.Composite, (k) => k.endsWith('_input'));
      if (composite != null) {
        nvmeCount++;
        disks.push({
          name: diskNames.nvme[nvmeCount - 1] || `NVMe ${nvmeCount}`,
          tempC: composite,
          type: 'nvme',
        });
      }
      continue;
    }

    // SATA via drivetemp module
    if (lcChip.startsWith('drivetemp')) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) {
        // drivetemp-scsi-0-0 → "SATA 1" (sequentially numbered like NVMe)
        const num = disks.filter((d) => d.type === 'sata').length + 1;
        disks.push({
          name: diskNames.sata[num - 1] || `SATA ${num}`,
          tempC: t,
          type: 'sata',
        });
      }
      continue;
    }

    // RAM DIMM temperature sensors (JEDEC JC-42.4 spec, embedded in many DDR4/DDR5 modules)
    if (lcChip.startsWith('jc42')) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) {
        dimmCount++;
        memory.push({ name: `DIMM ${dimmCount}`, tempC: t, type: 'dimm' });
      }
      continue;
    }

    // Network controller chip temps (Realtek, Intel, Broadcom)
    if (/^(r8169|e1000|igb|igc|ixgbe|bnx|mlx|tg3)/.test(lcChip)) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) {
        const family = lcChip.split(/[_\-]/)[0];
        const friendly = family === 'r8169' ? 'Realtek NIC'
          : /^(e1000|igb|igc|ixgbe)$/.test(family) ? `Intel NIC (${family})`
          : `${family.toUpperCase()} NIC`;
        network.push({ name: friendly, tempC: t, type: family });
      }
      continue;
    }

    // ACPI thermal zone — generic OS-level system temp, used as a fallback.
    if (lcChip.startsWith('acpitz')) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) acpiTempC = t;
      continue;
    }

    // Fans + chipset/motherboard temps (anything else, e.g. nct6798, it8688)
    // Decide a friendly source name based on the chip family.
    const fanSource = lcChip.startsWith('nct') || lcChip.startsWith('it86') || lcChip.startsWith('w836')
      ? 'Mobo'
      : lcChip.startsWith('nzxt')
        ? 'NZXT'
        : lcChip.startsWith('corsair')
          ? 'Corsair'
          : lcChip.startsWith('asus')
            ? 'Asus'
            : null;
    for (const [sensorName, sensor] of Object.entries(chip)) {
      if (typeof sensor !== 'object') continue;
      const tempVal = findFirstNumeric(sensor, (k) => /^temp\d+_input$/.test(k));
      const fanVal = findFirstNumeric(sensor, (k) => /^fan\d+_input$/.test(k));
      if (tempVal != null) {
        other.push({ chip: chipKey, name: sensorName, tempC: tempVal });
        // Promote a recognized system temp if we don't have one yet.
        if (systemTempC == null && SYSTEM_LABEL_PATTERNS.some((rx) => rx.test(sensorName))) {
          systemTempC = tempVal;
          systemTempLabel = friendlySystemSensorLabel(chipKey, sensorName);
        }
      }
      if (fanVal != null) {
        // Normalize "fan1" / "FAN 1" / "Fan_2" → "1" / "2" then prefix with source.
        const fanNum = sensorName.replace(/^fan[\s_]*/i, '').trim();
        const friendlyName = fanSource
          ? `${fanSource} fan ${fanNum}`
          : `${chipKey} ${sensorName}`;
        fans.push({ chip: chipKey, name: friendlyName, rpm: fanVal });
      }
    }
  }

  // Fall back to ACPI thermal zone if no labeled system temp was found.
  if (systemTempC == null && acpiTempC != null) {
    systemTempC = acpiTempC;
    systemTempLabel = friendlySystemSensorLabel('acpitz');
  }

  return { cpuTempC, systemTempC, systemTempLabel, cores, disks, memory, network, fans, other };
}

async function fetchSensorsData() {
  const now = Date.now();
  if (sensorsCache.data && now - sensorsCache.ts < SENSORS_CACHE_TTL) return sensorsCache.data;

  const [output, diskInventory] = await Promise.all([
    runSensors(),
    fetchSensorDiskInventory(),
  ]);
  const parsed = parseSensorsJson(output, diskInventory);

  sensorsCache = { data: parsed, ts: now };
  sensorsLastError = null;
  return parsed;
}

app.get('/api/sensors', async (_req, res) => {
  if (!SENSORS_ENABLED) return res.json({ disabled: true });
  if (SENSORS_MODE === 'ssh' && !SENSORS_SSH_HOST) {
    return res.status(503).json({ error: 'SENSORS_MODE=ssh but no host configured (set SENSORS_SSH_HOST or GPU_SSH_HOST)' });
  }
  try {
    const data = await fetchSensorsData();
    res.json({ sensors: data });
  } catch (err) {
    sensorsLastError = err.message;
    console.warn(`Sensors: ${SENSORS_MODE} sensors -j failed → ${err.message.split('\n')[0]}`);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/sensors/debug', async (_req, res) => {
  if (!SENSORS_ENABLED) return res.json({ disabled: true });
  const config = { mode: SENSORS_MODE };
  if (SENSORS_MODE === 'ssh') {
    config.host = SENSORS_SSH_HOST;
    config.user = SENSORS_SSH_USER;
    config.port = SENSORS_SSH_PORT;
    config.keyPath = SENSORS_SSH_KEY_PATH || '(default)';
  }
  try {
    const [raw, diskInventory] = await Promise.all([
      runSensors(),
      fetchSensorDiskInventory(),
    ]);
    res.json({
      config,
      diskInventory,
      raw: JSON.parse(raw),
      parsed: parseSensorsJson(raw, diskInventory),
      lastError: null,
    });
  } catch (err) {
    res.json({ config, raw: null, parsed: null, lastError: err.message });
  }
});

// ---------------------------------------------------------------------------
// UniFi UNAS Pro (undocumented local Drive API)
// ---------------------------------------------------------------------------

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

app.listen(PORT, () => {
  console.log(`Dashboard proxy listening on http://localhost:${PORT}`);
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
});
