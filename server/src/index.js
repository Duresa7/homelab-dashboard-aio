import 'dotenv/config';
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

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
    `/api2/json/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`
  );
  if (!data?.result) return null;
  for (const iface of data.result) {
    if (iface.name === 'lo') continue;
    const addrs = iface['ip-addresses'] || [];
    const v4 = addrs.find(
      (a) => a['ip-address-type'] === 'ipv4' && !a['ip-address'].startsWith('127.')
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

  const [nodeStatus, vmResources, storageList, networks] = await Promise.all([
    safePveFetch(`/api2/json/nodes/${primary.node}/status`),
    safePveFetch('/api2/json/cluster/resources?type=vm'),
    safePveFetch(`/api2/json/nodes/${primary.node}/storage`),
    safePveFetch(`/api2/json/nodes/${primary.node}/network`),
  ]);

  const totalCores = nodes.reduce((sum, n) => sum + (n.maxcpu || 0), 0);
  const vms = Array.isArray(vmResources) ? vmResources : [];

  const runningVms = vms.filter((v) => v.status === 'running');
  const coresAllocated = runningVms.reduce((sum, v) => sum + (v.maxcpu || 0), 0);
  const ramAllocatedBytes = runningVms.reduce((sum, v) => sum + (v.maxmem || 0), 0);

  // Resolve runtime IPs for running guests in parallel.
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
    })
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

async function runNvidiaSmi() {
  const queryArg = `--query-gpu=${NVIDIA_SMI_FIELDS}`;
  const formatArg = '--format=csv,noheader,nounits';

  if (GPU_MODE === 'local') {
    const { stdout } = await execFileP('nvidia-smi', [queryArg, formatArg], { timeout: 8000 });
    return stdout;
  }

  // SSH mode (default)
  const sshArgs = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=5',
    '-p', String(GPU_SSH_PORT),
  ];
  if (GPU_SSH_KEY_PATH) sshArgs.push('-i', GPU_SSH_KEY_PATH);
  sshArgs.push(`${GPU_SSH_USER}@${GPU_SSH_HOST}`, `nvidia-smi ${queryArg} ${formatArg}`);

  const { stdout } = await execFileP('ssh', sshArgs, { timeout: 8000 });
  return stdout;
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

async function runSensors() {
  if (SENSORS_MODE === 'local') {
    const { stdout } = await execFileP('sensors', ['-j'], { timeout: 8000 });
    return stdout;
  }
  const sshArgs = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=5',
    '-p', String(SENSORS_SSH_PORT),
  ];
  if (SENSORS_SSH_KEY_PATH) sshArgs.push('-i', SENSORS_SSH_KEY_PATH);
  sshArgs.push(`${SENSORS_SSH_USER}@${SENSORS_SSH_HOST}`, 'sensors -j');
  const { stdout } = await execFileP('ssh', sshArgs, { timeout: 8000 });
  return stdout;
}

function findFirstNumeric(obj, predicate) {
  if (!obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && predicate(k)) return v;
  }
  return null;
}

function parseSensorsJson(raw) {
  // sensors output can include warnings on stderr; -j strips them, but be defensive
  const json = typeof raw === 'string' ? JSON.parse(raw) : raw;

  let cpuTempC = null;
  let systemTempC = null;
  let systemTempLabel = null;
  let acpiTempC = null;
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
        disks.push({ name: chipKey, tempC: composite, type: 'nvme' });
      }
      continue;
    }

    // SATA via drivetemp module
    if (lcChip.startsWith('drivetemp')) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) disks.push({ name: chipKey, tempC: t, type: 'sata' });
      continue;
    }

    // RAM DIMM temperature sensors (JEDEC JC-42.4 spec, embedded in many DDR4/DDR5 modules)
    if (lcChip.startsWith('jc42')) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) {
        // jc42-i2c-0-19 → "DIMM @ 0x19"
        const addr = (chipKey.match(/-([0-9a-f]+)$/i) || [])[1];
        memory.push({ name: addr ? `DIMM @ 0x${addr}` : chipKey, tempC: t, type: 'dimm' });
      }
      continue;
    }

    // Network controller chip temps (Realtek, Intel, Broadcom)
    if (/^(r8169|e1000|igb|igc|ixgbe|bnx|mlx|tg3)/.test(lcChip)) {
      const t = findFirstNumeric(chip.temp1, (k) => k.endsWith('_input'));
      if (t != null) {
        const family = lcChip.split(/[_\-]/)[0];
        const friendly = family === 'r8169' ? 'Realtek r8169'
          : /^(e1000|igb|igc|ixgbe)$/.test(family) ? `Intel ${family}`
          : family.toUpperCase();
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
    for (const [sensorName, sensor] of Object.entries(chip)) {
      if (typeof sensor !== 'object') continue;
      const tempVal = findFirstNumeric(sensor, (k) => /^temp\d+_input$/.test(k));
      const fanVal = findFirstNumeric(sensor, (k) => /^fan\d+_input$/.test(k));
      if (tempVal != null) {
        other.push({ chip: chipKey, name: sensorName, tempC: tempVal });
        // Promote a recognized system temp if we don't have one yet.
        if (systemTempC == null && SYSTEM_LABEL_PATTERNS.some((rx) => rx.test(sensorName))) {
          systemTempC = tempVal;
          systemTempLabel = `${chipKey} · ${sensorName}`;
        }
      }
      if (fanVal != null) fans.push({ chip: chipKey, name: sensorName, rpm: fanVal });
    }
  }

  // Fall back to ACPI thermal zone if no labeled system temp was found.
  if (systemTempC == null && acpiTempC != null) {
    systemTempC = acpiTempC;
    systemTempLabel = 'acpitz';
  }

  return { cpuTempC, systemTempC, systemTempLabel, cores, disks, memory, network, fans, other };
}

async function fetchSensorsData() {
  const now = Date.now();
  if (sensorsCache.data && now - sensorsCache.ts < SENSORS_CACHE_TTL) return sensorsCache.data;

  const output = await runSensors();
  const parsed = parseSensorsJson(output);

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
    const raw = await runSensors();
    res.json({ config, raw: JSON.parse(raw), parsed: parseSensorsJson(raw), lastError: null });
  } catch (err) {
    res.json({ config, raw: null, parsed: null, lastError: err.message });
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
