// Proxmox VE integration. Normalizes the primary node + cluster VMs/LXCs,
// storage, and physical disks into the dashboard's `proxmox` slice.
import type { Express, Request, Response } from 'express';

import { insecureFetch, makeSafeFetch } from '../lib/http.js';
import { withTtlCache } from '../lib/cache.js';
import { isEnabled, formatUptime } from '../lib/env.js';
import { normalizeDiskParts } from '../sensors/parse.js';
import { errorMessage } from '../lib/errors.js';
import type { Upstream } from '../types.js';
import type { ProxmoxApiResponse } from '../../../shared/wire.ts';
import { selectionConfig, text, type Provider } from './provider.js';

const PVE_CACHE_TTL = Number(process.env.PROXMOX_POLL_INTERVAL) || 5000;
const GB = 1024 ** 3;
const TB = 1024 ** 4;

export interface ProxmoxRuntimeConfig {
  enabled: boolean;
  baseUrl?: string;
  tokenId?: string;
  tokenSecret?: string;
  node?: string;
}

function configFromEnv(): ProxmoxRuntimeConfig {
  return {
    enabled: isEnabled(process.env.PROXMOX_ENABLED),
    baseUrl: process.env.PROXMOX_BASE_URL,
    tokenId: process.env.PROXMOX_TOKEN_ID,
    tokenSecret: process.env.PROXMOX_TOKEN_SECRET,
    node: process.env.PROXMOX_NODE || '',
  };
}

let config = configFromEnv();

async function pveFetch(path: string): Promise<Upstream> {
  if (!config.baseUrl) throw new Error('Proxmox base URL is not configured');
  const url = `${config.baseUrl}${path}`;
  const res = await insecureFetch(url, {
    headers: {
      Authorization: `PVEAPIToken=${config.tokenId ?? ''}=${config.tokenSecret ?? ''}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Proxmox API ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as Upstream;
  return json.data;
}

const safePveFetch = makeSafeFetch('Proxmox', pveFetch);

function mapVmState(s: Upstream): 'running' | 'stopped' | 'paused' {
  if (s === 'running') return 'running';
  if (s === 'paused' || s === 'suspended') return 'paused';
  return 'stopped';
}

function trimPveVersion(raw: Upstream) {
  if (!raw) return 'n/a';
  // "pve-manager/9.1.6/71482d1833ded40a" → "9.1.6"
  const m = String(raw).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : String(raw);
}

function pickNodeIp(networks: Upstream) {
  if (!Array.isArray(networks)) return null;
  const bridgeWithIp = networks.find((n: Upstream) => n.active && n.address && n.type === 'bridge');
  if (bridgeWithIp) return bridgeWithIp.address;
  const anyWithIp = networks.find((n: Upstream) => n.active && n.address);
  return anyWithIp ? anyWithIp.address : null;
}

async function getQemuIp(node: string, vmid: number | string) {
  // Requires qemu-guest-agent installed AND running inside the VM.
  const data = await safePveFetch(
    `/api2/json/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
  );
  if (!data?.result) return null;
  for (const iface of data.result) {
    if (iface.name === 'lo') continue;
    const addrs = iface['ip-addresses'] || [];
    const v4 = addrs.find(
      (a: Upstream) => a['ip-address-type'] === 'ipv4' && !a['ip-address'].startsWith('127.'),
    );
    if (v4) return v4['ip-address'];
  }
  return null;
}

async function getLxcIp(node: string, vmid: number | string) {
  // Runtime IPs via /interfaces (only works while running).
  const ifaces = await safePveFetch(`/api2/json/nodes/${node}/lxc/${vmid}/interfaces`);
  if (Array.isArray(ifaces)) {
    for (const iface of ifaces) {
      if (iface.name === 'lo') continue;
      const ip = iface.inet || iface.inet6;
      if (ip) return String(ip).split('/')[0];
    }
  }
  // Fallback: parse static IP from /config (net0: ...,ip=198.51.100.5/24)
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

async function fetchProxmoxDataRaw(): Promise<ProxmoxApiResponse> {
  const nodes: Upstream[] = (await pveFetch('/api2/json/nodes')) || [];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('No Proxmox nodes returned');
  }

  const primary =
    nodes.find((n: Upstream) => n.node === (config.node || '')) ||
    nodes.find((n: Upstream) => n.status === 'online') ||
    nodes[0];

  // Physical disks and ZFS pools are node-local resources; query every online
  // node (the API proxies to peers) so cluster setups see all hardware, not
  // just the primary's. An offline node simply contributes nothing.
  const diskNodes = nodes.filter((n: Upstream) => n.status === 'online' && n.node);

  const [
    nodeStatus,
    vmResources,
    storageResources,
    storageList,
    networks,
    perNodeDisks,
    perNodeZfs,
  ] = await Promise.all([
    safePveFetch(`/api2/json/nodes/${primary.node}/status`),
    safePveFetch('/api2/json/cluster/resources?type=vm'),
    safePveFetch('/api2/json/cluster/resources?type=storage'),
    safePveFetch(`/api2/json/nodes/${primary.node}/storage`),
    safePveFetch(`/api2/json/nodes/${primary.node}/network`),
    Promise.all(
      diskNodes.map(async (n: Upstream) => ({
        node: String(n.node),
        disks: await safePveFetch(`/api2/json/nodes/${n.node}/disks/list`),
      })),
    ),
    Promise.all(
      diskNodes.map(async (n: Upstream) => ({
        node: String(n.node),
        pools: await safePveFetch(`/api2/json/nodes/${n.node}/disks/zfs`),
      })),
    ),
  ]);

  const vms: Upstream[] = Array.isArray(vmResources) ? vmResources : [];

  const runningVms = vms.filter((v: Upstream) => v.status === 'running');
  const coresAllocated = runningVms.reduce((sum: number, v: Upstream) => sum + (v.maxcpu || 0), 0);
  const ramAllocatedBytes = runningVms.reduce(
    (sum: number, v: Upstream) => sum + (v.maxmem || 0),
    0,
  );

  // QEMU IPs need qemu-guest-agent in the VM; without it we just return null.
  const vmIps: Record<string, string> = {};
  await Promise.all(
    runningVms.map(async (v: Upstream) => {
      try {
        const ip =
          v.type === 'lxc' ? await getLxcIp(v.node, v.vmid) : await getQemuIp(v.node, v.vmid);
        if (ip) vmIps[v.vmid] = ip;
      } catch {
        /* ignore */
      }
    }),
  );

  // Dedupe by storage name so shared pools aren't counted twice.
  const resourceStorages: Upstream[] = Array.isArray(storageResources)
    ? storageResources.filter((s: Upstream) => s.storage)
    : [];
  const clusterStorages: Upstream[] = resourceStorages.length
    ? resourceStorages
    : Array.isArray(storageList)
      ? storageList.map((s: Upstream) => ({ ...s, node: primary.node }))
      : [];
  // cluster/resources reports a shared pool once per node; collapse it to a
  // single entry (keyed by name) so it isn't listed and sampled N times.
  const displayStorages: Upstream[] = [];
  const seenSharedStorage = new Set<string>();
  for (const s of clusterStorages) {
    if (s.shared) {
      const name = String(s.storage || '');
      if (seenSharedStorage.has(name)) continue;
      seenSharedStorage.add(name);
    }
    displayStorages.push(s);
  }
  // Field names differ by source: cluster/resources rows carry
  // disk/maxdisk/plugintype/status, the per-node /storage fallback carries
  // used/total/type/enabled/active. Normalize before any math.
  const storUsed = (s: Upstream) => Number(s.used ?? s.disk) || 0;
  const storTotal = (s: Upstream) => Number(s.total ?? s.maxdisk) || 0;
  const storType = (s: Upstream) =>
    String(s.plugintype || (s.type !== 'storage' ? s.type : '') || '');
  const storActive = (s: Upstream) =>
    s.active != null || s.enabled != null
      ? !!s.active && (s.enabled ?? true) !== false
      : String(s.status ?? 'available') === 'available';

  const seenStorage = new Set<string>();
  let storageUsed = 0;
  let storageTotal = 0;
  if (Array.isArray(clusterStorages)) {
    for (const s of clusterStorages) {
      if (!storActive(s) || !storTotal(s)) continue;
      const key = s.shared ? String(s.storage) : `${s.node || primary.node}:${s.storage}`;
      if (seenStorage.has(key)) continue;
      seenStorage.add(key);
      storageUsed += storUsed(s);
      storageTotal += storTotal(s);
    }
  }

  const zfsHealthByName = new Map<string, Upstream>();
  for (const entry of perNodeZfs) {
    if (!Array.isArray(entry.pools)) continue;
    for (const z of entry.pools) {
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

  const clusterNodes = nodes.map((n: Upstream) => {
    const memTotal = n.maxmem || 0;
    const memUsed = n.mem || 0;
    const diskTotal = n.maxdisk || 0;
    const diskUsed = n.disk || 0;
    return {
      name: n.node || '',
      status: n.status || 'unknown',
      level: n.level || null,
      cpu: (n.cpu || 0) * 100,
      maxcpu: n.maxcpu || 0,
      ram: memTotal ? (memUsed / memTotal) * 100 : 0,
      ramUsedGB: memUsed / GB,
      ramTotalGB: memTotal / GB,
      disk: diskTotal ? (diskUsed / diskTotal) * 100 : 0,
      diskUsedTB: diskUsed / TB,
      diskTotalTB: diskTotal / TB,
      uptime: formatUptime(n.uptime || 0),
      uptimeSec: n.uptime || 0,
    };
  });
  const onlineNodes = clusterNodes.filter((n) => n.status === 'online');
  const clusterMemUsed = nodes.reduce((sum: number, n: Upstream) => sum + (n.mem || 0), 0);
  const clusterMemTotal = nodes.reduce((sum: number, n: Upstream) => sum + (n.maxmem || 0), 0);
  const totalCores = nodes.reduce((sum: number, n: Upstream) => sum + (n.maxcpu || 0), 0);
  const usedCores = nodes.reduce(
    (sum: number, n: Upstream) => sum + (n.cpu || 0) * (n.maxcpu || 0),
    0,
  );

  return {
    proxmox: {
      nodes: clusterNodes,
      cluster: {
        nodesOnline: onlineNodes.length,
        nodesTotal: nodes.length,
        cpuUsed: usedCores,
        cpuTotal: totalCores,
        cpuPct: totalCores ? (usedCores / totalCores) * 100 : 0,
        memUsedGB: clusterMemUsed / GB,
        memTotalGB: clusterMemTotal / GB,
        memPct: clusterMemTotal ? (clusterMemUsed / clusterMemTotal) * 100 : 0,
        storageUsedTB: storageUsed / TB,
        storageTotalTB: storageTotal / TB,
        storagePct: storageTotal ? (storageUsed / storageTotal) * 100 : 0,
        guestsRunning: runningVms.length,
        guestsTotal: vms.length,
      },
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
      vms: vms.map((v: Upstream) => ({
        id: v.vmid,
        name: v.name || `vm-${v.vmid}`,
        type: v.type === 'lxc' ? 'LXC' : 'VM',
        state: mapVmState(v.status),
        cpu: (v.cpu || 0) * 100,
        ram: v.maxmem ? Math.round((v.mem / v.maxmem) * 100) : 0,
        disk: v.maxdisk ? Math.round(v.maxdisk / GB) : 0,
        node: v.node || primary.node,
        ip: vmIps[v.vmid] || null,
      })),
      disks: perNodeDisks.flatMap((entry) =>
        (Array.isArray(entry.disks) ? entry.disks : []).map((d: Upstream) => {
          const friendly = normalizeDiskParts(d);
          return {
            node: entry.node,
            devpath: d.devpath || '',
            model: friendly.model,
            vendor: friendly.vendor,
            serial: d.serial || null,
            sizeBytes: Number(d.size) || 0,
            type: (d.type || 'unknown').toLowerCase(), // nvme | ssd | hdd | usb
            used: d.used || null, // "LVM", "ZFS", "partitions", null
            health: d.health || null, // "PASSED", "FAILED", "UNKNOWN"
            wearout: typeof d.wearout === 'number' ? d.wearout : null,
            rpm: Number(d.rpm) || 0,
          };
        }),
      ),
      storages: displayStorages.map((s: Upstream) => {
        const zfsKey = String(s.pool || s.storage || '');
        return {
          name: s.storage || '',
          node: s.node || primary.node,
          type: storType(s),
          content: s.content || '',
          usedTB: storUsed(s) / TB,
          totalTB: storTotal(s) / TB,
          active: storActive(s),
          shared: !!s.shared,
          zfsHealth:
            zfsHealthByName.get(zfsKey) || zfsHealthByName.get(String(s.storage || '')) || null,
        };
      }),
      coresAllocated,
      coresTotal: totalCores,
    },
  };
}

const fetchProxmoxData = withTtlCache(fetchProxmoxDataRaw, PVE_CACHE_TTL);

async function fetchNodeDetailRaw(node: string) {
  const nodes: Upstream[] = (await pveFetch('/api2/json/nodes')) || [];
  if (!Array.isArray(nodes) || !nodes.some((n: Upstream) => n.node === node)) {
    throw new Error(`Unknown Proxmox node "${node}"`);
  }
  const [status, disks, zfs, networks, storages] = await Promise.all([
    safePveFetch(`/api2/json/nodes/${node}/status`),
    safePveFetch(`/api2/json/nodes/${node}/disks/list`),
    safePveFetch(`/api2/json/nodes/${node}/disks/zfs`),
    safePveFetch(`/api2/json/nodes/${node}/network`),
    safePveFetch(`/api2/json/nodes/${node}/storage`),
  ]);
  return {
    status,
    disks: Array.isArray(disks) ? disks : [],
    zfs: Array.isArray(zfs) ? zfs : [],
    networks: Array.isArray(networks) ? networks : [],
    storages: Array.isArray(storages) ? storages : [],
  };
}

const nodeDetailCaches = new Map<string, ReturnType<typeof withTtlCache<Upstream>>>();

function fetchNodeDetail(node: string) {
  let cached = nodeDetailCaches.get(node);
  if (!cached) {
    cached = withTtlCache(() => fetchNodeDetailRaw(node), PVE_CACHE_TTL);
    nodeDetailCaches.set(node, cached);
  }
  return cached();
}

export function fetchProxmoxSnapshot() {
  return fetchProxmoxData();
}

export const proxmoxStatus = {
  enabled: config.enabled,
  configured: config.enabled && !!(config.baseUrl && config.tokenId && config.tokenSecret),
  baseUrl: config.baseUrl,
};

export function configureProxmox(next: ProxmoxRuntimeConfig): void {
  config = {
    enabled: next.enabled,
    baseUrl: next.baseUrl,
    tokenId: next.tokenId,
    tokenSecret: next.tokenSecret,
    node: next.node || '',
  };
  fetchProxmoxData.clear();
  nodeDetailCaches.clear();
  proxmoxStatus.enabled = config.enabled;
  proxmoxStatus.configured =
    config.enabled && !!(config.baseUrl && config.tokenId && config.tokenSecret);
  proxmoxStatus.baseUrl = config.baseUrl;
}

/** Liveness probe used by /api/health/live. */
export function probeProxmox() {
  return pveFetch('/api2/json/version');
}

export const proxmoxProvider: Provider<ProxmoxApiResponse> = {
  id: 'proxmox',
  capabilityId: 'datacenter',
  logName: 'Proxmox',
  status: proxmoxStatus,
  notConfiguredMessage:
    'Proxmox not configured. Set base URL, token ID, and token secret in Setup.',
  configure(selection) {
    const cfg = selectionConfig(selection);
    configureProxmox({
      enabled: !!selection?.enabled,
      baseUrl: text(cfg.baseUrl),
      tokenId: text(cfg.tokenId),
      tokenSecret: text(cfg.tokenSecret),
      node: text(cfg.node) || '',
    });
  },
  fetch: fetchProxmoxData,
  probe: probeProxmox,
  async debug() {
    const out: Record<string, Upstream> = {};
    try {
      out.nodes = await pveFetch('/api2/json/nodes');
    } catch (e) {
      out.nodesError = errorMessage(e);
    }
    const nodeName = config.node || out.nodes?.[0]?.node;
    if (nodeName) {
      try {
        out.nodeStatus = await pveFetch(`/api2/json/nodes/${nodeName}/status`);
      } catch (e) {
        out.nodeStatusError = errorMessage(e);
      }
    }
    try {
      out.clusterResources = await pveFetch('/api2/json/cluster/resources?type=vm');
    } catch (e) {
      out.clusterResourcesError = errorMessage(e);
    }
    return out;
  },
};

export function registerProxmoxNodeRoutes(app: Express) {
  app.get('/api/proxmox/node/:node', async (req: Request, res: Response) => {
    if (!config.enabled) return res.status(503).json({ error: 'Proxmox disabled' });
    if (!config.baseUrl || !config.tokenId || !config.tokenSecret) {
      return res.status(503).json({ error: 'Proxmox not configured' });
    }
    const node = String(req.params.node || '').trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(node)) {
      return res.status(400).json({ error: 'Invalid Proxmox node name' });
    }
    try {
      res.json(await fetchNodeDetail(node));
    } catch (err) {
      const msg = errorMessage(err);
      res.status(msg.startsWith('Unknown Proxmox node') ? 404 : 502).json({ error: msg });
    }
  });
}
