// Proxmox VE integration. Normalizes the primary node + cluster VMs/LXCs,
// storage, and physical disks into the dashboard's `proxmox` slice.
import type { Express, Request, Response } from 'express';

import { insecureFetch, makeSafeFetch } from '../lib/http.js';
import { withTtlCache } from '../lib/cache.js';
import { isDebugEndpointEnabled, isEnabled, formatUptime } from '../lib/env.js';
import { normalizeDiskParts } from '../sensors/parse.js';
import { errorMessage } from '../lib/errors.js';
import type { Upstream } from '../types.js';

const PVE_CACHE_TTL = Number(process.env.PROXMOX_POLL_INTERVAL) || 5000;

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

function mapVmState(s: Upstream) {
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

async function fetchProxmoxDataRaw() {
  const nodes: Upstream[] = (await pveFetch('/api2/json/nodes')) || [];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('No Proxmox nodes returned');
  }

  const primary =
    nodes.find((n: Upstream) => n.node === (config.node || '')) ||
    nodes.find((n: Upstream) => n.status === 'online') ||
    nodes[0];

  const [nodeStatus, vmResources, storageList, networks, physicalDisks, zfsPools] =
    await Promise.all([
      safePveFetch(`/api2/json/nodes/${primary.node}/status`),
      safePveFetch('/api2/json/cluster/resources?type=vm'),
      safePveFetch(`/api2/json/nodes/${primary.node}/storage`),
      safePveFetch(`/api2/json/nodes/${primary.node}/network`),
      safePveFetch(`/api2/json/nodes/${primary.node}/disks/list`),
      safePveFetch(`/api2/json/nodes/${primary.node}/disks/zfs`),
    ]);

  const totalCores = nodes.reduce((sum: number, n: Upstream) => sum + (n.maxcpu || 0), 0);
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
  const seenStorage = new Set<string>();
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

  const zfsHealthByName = new Map<string, Upstream>();
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

  return {
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
      vms: vms.map((v: Upstream) => ({
        id: v.vmid,
        name: v.name || `vm-${v.vmid}`,
        type: v.type === 'lxc' ? 'LXC' : 'VM',
        state: mapVmState(v.status),
        cpu: (v.cpu || 0) * 100,
        ram: v.maxmem ? Math.round((v.mem / v.maxmem) * 100) : 0,
        disk: v.maxdisk ? Math.round(v.maxdisk / GB) : 0,
        ip: vmIps[v.vmid] || null,
      })),
      disks: (Array.isArray(physicalDisks) ? physicalDisks : []).map((d: Upstream) => {
        const friendly = normalizeDiskParts(d);
        return {
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
      storages: (Array.isArray(storageList) ? storageList : []).map((s: Upstream) => {
        const zfsKey = String(s.pool || s.storage || '');
        return {
          name: s.storage || '',
          type: s.type || '',
          content: s.content || '',
          usedTB: (s.used || 0) / TB,
          totalTB: (s.total || 0) / TB,
          active: !!s.active,
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
  proxmoxStatus.enabled = config.enabled;
  proxmoxStatus.configured =
    config.enabled && !!(config.baseUrl && config.tokenId && config.tokenSecret);
  proxmoxStatus.baseUrl = config.baseUrl;
}

/** Liveness probe used by /api/health/live. */
export function probeProxmox() {
  return pveFetch('/api2/json/version');
}

export function registerProxmox(app: Express) {
  app.get('/api/proxmox/debug', async (_req: Request, res: Response) => {
    if (!isDebugEndpointEnabled()) return res.status(404).json({ error: 'Not found' });
    if (!config.enabled) return res.status(503).json({ error: 'Proxmox disabled' });
    if (!config.baseUrl || !config.tokenId || !config.tokenSecret) {
      return res.status(503).json({ error: 'Proxmox not configured' });
    }
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
    res.json(out);
  });

  app.get('/api/proxmox', async (_req: Request, res: Response) => {
    if (!config.enabled) {
      return res.json({ disabled: true });
    }
    if (!config.baseUrl || !config.tokenId || !config.tokenSecret) {
      return res.status(503).json({
        error: 'Proxmox not configured. Set base URL, token ID, and token secret in Setup.',
      });
    }
    try {
      const data = await fetchProxmoxData();
      res.json(data);
    } catch (err) {
      console.error('Proxmox API error:', errorMessage(err));
      res.status(502).json({ error: errorMessage(err) });
    }
  });
}
