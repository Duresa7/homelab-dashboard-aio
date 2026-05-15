import 'dotenv/config';
import express from 'express';

// UniFi controllers use self-signed certs; disable TLS verification for proxy requests
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

function isEnabled(value, defaultEnabled = true) {
  if (value === undefined || value === null || value === '') return defaultEnabled;
  return !['false', '0', 'no', 'off', 'disabled'].includes(String(value).trim().toLowerCase());
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

let cache = { data: null, ts: 0 };

async function uniFetch(path) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
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
  const wirelessCount = clients.filter(c => c.type === 'WIRELESS').length;
  const wiredCount = clients.filter(c => c.type === 'WIRED').length;
  const vpnCount = clients.filter(c => c.type === 'VPN' || c.type === 'TELEPORT').length;

  for (const c of clients) {
    const devId = c.uplinkDeviceId;
    if (devId) {
      clientsByDeviceId[devId] = (clientsByDeviceId[devId] || 0) + 1;
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
    proxmox: {
      enabled: PROXMOX_ENABLED,
      configured: !!(PVE_BASE_URL && PVE_TOKEN_ID && PVE_TOKEN_SECRET),
    },
  });
});

// ---------------------------------------------------------------------------
// Proxmox VE
// ---------------------------------------------------------------------------

const PROXMOX_ENABLED = isEnabled(process.env.PROXMOX_ENABLED);
const PVE_BASE_URL = process.env.PROXMOX_BASE_URL;
const PVE_TOKEN_ID = process.env.PROXMOX_TOKEN_ID;
const PVE_TOKEN_SECRET = process.env.PROXMOX_TOKEN_SECRET;
const PVE_NODE_HINT = process.env.PROXMOX_NODE || '';
const PVE_CACHE_TTL = Number(process.env.PROXMOX_POLL_INTERVAL) || 5000;

let pveCache = { data: null, ts: 0 };

async function pveFetch(path) {
  const url = `${PVE_BASE_URL}${path}`;
  const res = await fetch(url, {
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
  try { return await pveFetch(path); } catch { return null; }
}

function mapVmState(s) {
  if (s === 'running') return 'running';
  if (s === 'paused' || s === 'suspended') return 'paused';
  return 'stopped';
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

  const [nodeStatus, vmResources] = await Promise.all([
    safePveFetch(`/api2/json/nodes/${primary.node}/status`),
    safePveFetch('/api2/json/cluster/resources?type=vm'),
  ]);

  const totalCores = nodes.reduce((sum, n) => sum + (n.maxcpu || 0), 0);
  const vms = Array.isArray(vmResources) ? vmResources : [];

  const coresAllocated = vms
    .filter((v) => v.status === 'running')
    .reduce((sum, v) => sum + (v.maxcpu || 0), 0);

  const memUsedPct = nodeStatus?.memory
    ? (nodeStatus.memory.used / nodeStatus.memory.total) * 100
    : primary.maxmem ? (primary.mem / primary.maxmem) * 100 : 0;

  const cpuPct = (nodeStatus?.cpu ?? primary.cpu ?? 0) * 100;
  const uptimeSec = nodeStatus?.uptime ?? primary.uptime ?? 0;
  const pveVersion =
    nodeStatus?.pveversion ||
    nodeStatus?.['current-kernel']?.release ||
    primary.level ||
    'n/a';

  const result = {
    proxmox: {
      nodes: nodes.length,
      node: {
        name: primary.node,
        cpu: cpuPct,
        ram: memUsedPct,
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
        disk: v.maxdisk ? Math.round(v.maxdisk / (1024 ** 3)) : 0,
      })),
      coresAllocated,
      coresTotal: totalCores,
    },
  };

  pveCache = { data: result, ts: now };
  return result;
}

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
});
