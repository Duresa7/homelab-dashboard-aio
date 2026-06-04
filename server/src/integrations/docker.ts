// Portainer-backed Docker integration. Normalizes one or more Portainer
// endpoints into the dashboard's `docker` slice (hosts + containers + counts).
import type { Express, Request, Response } from 'express';

import { insecureFetch, makeSafeFetch } from '../lib/http.js';
import { withTtlCache } from '../lib/cache.js';
import { isDebugEndpointEnabled, isEnabled, trimBaseUrl, formatUptime } from '../lib/env.js';
import { errorMessage } from '../lib/errors.js';
import type { Upstream } from '../types.js';

const PORTAINER_ENABLED = isEnabled(process.env.PORTAINER_ENABLED, false);
const PORTAINER_BASE_URL = trimBaseUrl(process.env.PORTAINER_BASE_URL);
const PORTAINER_API_KEY = process.env.PORTAINER_API_KEY || process.env.PORTAINER_TOKEN || '';
const PORTAINER_CACHE_TTL = Number(process.env.PORTAINER_POLL_INTERVAL) || 10000;
const PORTAINER_STATS_ENABLED = isEnabled(process.env.PORTAINER_STATS_ENABLED, true);

async function portainerFetch(path: string, { timeoutMs = 10000 } = {}): Promise<Upstream> {
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
      throw new Error(
        `Portainer API ${res.status} ${res.statusText} — ${path} — ${body.slice(0, 200)}`,
      );
    }
    if (res.status === 204) return null;
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

const safePortainerFetch = makeSafeFetch('Portainer', portainerFetch);

function endpointId(endpoint: Upstream) {
  return endpoint.Id ?? endpoint.ID ?? endpoint.id;
}

function endpointName(endpoint: Upstream) {
  return endpoint.Name || endpoint.name || `Docker ${endpointId(endpoint)}`;
}

function endpointAddress(endpoint: Upstream) {
  const raw =
    endpoint.PublicURL || endpoint.URL || endpoint.Url || endpoint.EdgeID || endpoint.EdgeId || '';
  return (
    String(raw)
      .replace(/^tcp:\/\//, '')
      .replace(/^https?:\/\//, '') || '—'
  );
}

function endpointOnline(endpoint: Upstream, dockerReachable: boolean) {
  const status = endpoint.Status ?? endpoint.status;
  if (dockerReachable) return true;
  if (typeof status === 'number') return status === 1;
  if (typeof status === 'string')
    return ['up', 'online', 'active', 'healthy'].includes(status.toLowerCase());
  return false;
}

function containerName(container: Upstream) {
  const names = Array.isArray(container.Names) ? container.Names : [];
  return (names[0] || container.Name || container.Id || 'container').replace(/^\/+/, '');
}

function containerState(container: Upstream) {
  const raw = String(container.State || container.Status || '').toLowerCase();
  if (raw.includes('pause')) return 'paused';
  if (raw.includes('running') || raw === 'up') return 'running';
  return 'stopped';
}

function containerStack(container: Upstream) {
  const labels = container.Labels || {};
  return (
    labels['com.docker.compose.project'] ||
    labels['io.portainer.stack.name'] ||
    labels['com.docker.stack.namespace'] ||
    'standalone'
  );
}

function containerUptime(container: Upstream) {
  if (containerState(container) !== 'running' || !container.Created) return '—';
  return formatUptime(Math.max(0, Math.floor(Date.now() / 1000) - Number(container.Created)));
}

function cpuPctFromStats(stats: Upstream) {
  const cpuDelta =
    (stats?.cpu_stats?.cpu_usage?.total_usage || 0) -
    (stats?.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta =
    (stats?.cpu_stats?.system_cpu_usage || 0) - (stats?.precpu_stats?.system_cpu_usage || 0);
  const onlineCpus =
    stats?.cpu_stats?.online_cpus || stats?.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return Math.max(0, (cpuDelta / systemDelta) * onlineCpus * 100);
}

function memMbFromStats(stats: Upstream) {
  const usage = stats?.memory_stats?.usage || 0;
  const cache = stats?.memory_stats?.stats?.cache || 0;
  return Math.max(0, Math.round((usage - cache) / 1024 ** 2));
}

async function containerStats(endpointIdValue: string, containerId: string) {
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

async function fetchEndpointDocker(endpoint: Upstream) {
  const id = endpointId(endpoint);
  const [containers, info, version] = await Promise.all([
    safePortainerFetch(`/api/endpoints/${id}/docker/containers/json?all=true`, null),
    safePortainerFetch(`/api/endpoints/${id}/docker/info`, null),
    safePortainerFetch(`/api/endpoints/${id}/docker/version`, null),
  ]);

  const reachable = Array.isArray(containers);
  const mappedContainers = await Promise.all(
    (containers || []).map(async (c: Upstream) => {
      const state = containerState(c);
      const stats = state === 'running' ? await containerStats(id, c.Id) : { cpu: 0, memMB: 0 };
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
    }),
  );

  const memTotal = info?.MemTotal || 0;
  const hostMemMb = mappedContainers.reduce((sum, c) => sum + c.memMB, 0);
  const hostRamPct = memTotal ? Math.round(((hostMemMb * 1024 ** 2) / memTotal) * 100) : 0;
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

async function fetchPortainerDockerDataRaw() {
  const endpoints = await portainerFetch('/api/endpoints');
  const endpointList: Upstream[] = Array.isArray(endpoints) ? endpoints : [];
  const dockerResults = await Promise.all(endpointList.map(fetchEndpointDocker));
  const hosts = dockerResults.map((r) => r.host);
  const containers = dockerResults.flatMap((r) => r.containers);
  const running = containers.filter((c) => c.state === 'running').length;
  const stopped = containers.filter((c) => c.state !== 'running').length;

  return {
    docker: {
      running,
      stopped,
      total: containers.length,
      updates: 0,
      hosts,
      containers,
    },
  };
}

const fetchPortainerDockerData = withTtlCache(fetchPortainerDockerDataRaw, PORTAINER_CACHE_TTL);

// Status descriptor consumed by the aggregate /api/health route and startup
// logging in index.js, so they don't need to reach into Portainer config.
export const dockerStatus = {
  enabled: PORTAINER_ENABLED,
  configured: !!(PORTAINER_BASE_URL && PORTAINER_API_KEY),
  baseUrl: PORTAINER_BASE_URL,
};

/** Liveness probe used by /api/health/live. */
export function probeDocker(timeoutMs: number) {
  return portainerFetch('/api/endpoints', { timeoutMs });
}

export function registerDocker(app: Express) {
  app.get('/api/docker', async (_req: Request, res: Response) => {
    if (!PORTAINER_ENABLED) return res.json({ disabled: true });
    if (!PORTAINER_BASE_URL || !PORTAINER_API_KEY) {
      return res.status(503).json({
        error: 'Portainer not configured. Set PORTAINER_BASE_URL and PORTAINER_API_KEY in .env',
      });
    }
    try {
      res.json(await fetchPortainerDockerData());
    } catch (err) {
      console.error('Portainer API error:', errorMessage(err));
      res.status(502).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/docker/debug', async (_req: Request, res: Response) => {
    if (!isDebugEndpointEnabled()) return res.status(404).json({ error: 'Not found' });
    if (!PORTAINER_ENABLED) return res.json({ disabled: true });
    const c = fetchPortainerDockerData.peek();
    res.json({
      config: {
        baseUrl: PORTAINER_BASE_URL || null,
        hasKey: !!PORTAINER_API_KEY,
        statsEnabled: PORTAINER_STATS_ENABLED,
      },
      cache: c.data
        ? {
            ageMs: Date.now() - c.ts,
            hosts: c.data.docker.hosts.length,
            containers: c.data.docker.containers.length,
          }
        : null,
      lastError: c.lastError,
    });
  });
}
