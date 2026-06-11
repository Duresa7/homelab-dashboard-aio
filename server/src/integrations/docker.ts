import { insecureFetch, makeSafeFetch } from '../lib/http.js';
import { withTtlCache } from '../lib/cache.js';
import { isEnabled, trimBaseUrl, formatUptime } from '../lib/env.js';
import type { Upstream } from '../types.js';
import type { DockerApiResponse } from '../../../shared/wire.ts';
import { bool, selectionConfig, text, type Provider } from './provider.js';

const PORTAINER_CACHE_TTL = Number(process.env.PORTAINER_POLL_INTERVAL) || 10000;

export interface DockerRuntimeConfig {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  statsEnabled?: boolean;
}

function configFromEnv(): DockerRuntimeConfig {
  return {
    enabled: isEnabled(process.env.PORTAINER_ENABLED, false),
    baseUrl: trimBaseUrl(process.env.PORTAINER_BASE_URL),
    apiKey: process.env.PORTAINER_API_KEY || process.env.PORTAINER_TOKEN || '',
    statsEnabled: isEnabled(process.env.PORTAINER_STATS_ENABLED, true),
  };
}

let config = configFromEnv();

async function portainerFetch(path: string, { timeoutMs = 10000 } = {}): Promise<Upstream> {
  if (!config.baseUrl) throw new Error('Portainer base URL is not configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await insecureFetch(`${config.baseUrl}${path}`, {
      headers: {
        'X-API-Key': config.apiKey ?? '',
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

function endpointOnline(endpoint: Upstream, dockerReachable: boolean): boolean {
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

function containerState(container: Upstream): 'running' | 'stopped' | 'paused' {
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
  if (!config.statsEnabled) return { cpu: 0, memMB: 0 };
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
      status: endpointOnline(endpoint, reachable) ? ('online' as const) : ('offline' as const),
    },
    containers: mappedContainers,
  };
}

async function fetchPortainerDockerDataRaw(): Promise<DockerApiResponse> {
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

export const dockerStatus = {
  enabled: config.enabled,
  configured: config.enabled && !!(config.baseUrl && config.apiKey),
  baseUrl: config.baseUrl,
};

export function configureDocker(next: DockerRuntimeConfig): void {
  config = {
    enabled: next.enabled,
    baseUrl: trimBaseUrl(next.baseUrl),
    apiKey: next.apiKey ?? '',
    statsEnabled: next.statsEnabled ?? true,
  };
  fetchPortainerDockerData.clear();
  dockerStatus.enabled = config.enabled;
  dockerStatus.configured = config.enabled && !!(config.baseUrl && config.apiKey);
  dockerStatus.baseUrl = config.baseUrl;
}

export function probeDocker(timeoutMs: number) {
  return portainerFetch('/api/endpoints', { timeoutMs });
}

export const dockerProvider: Provider<DockerApiResponse> = {
  id: 'docker',
  capabilityId: 'containers',
  healthId: 'portainer',
  logName: 'Portainer',
  status: dockerStatus,
  notConfiguredMessage: 'Portainer not configured. Set base URL and API key in Setup.',
  configure(selection) {
    const cfg = selectionConfig(selection);
    configureDocker({
      enabled: !!selection?.enabled,
      baseUrl: text(cfg.baseUrl),
      apiKey: text(cfg.apiKey),
      statsEnabled: bool(cfg.statsEnabled, true),
    });
  },
  fetch: fetchPortainerDockerData,
  probe: probeDocker,
  debug() {
    const c = fetchPortainerDockerData.peek();
    return {
      config: {
        baseUrl: config.baseUrl || null,
        hasKey: !!config.apiKey,
        statsEnabled: !!config.statsEnabled,
      },
      cache: c.data
        ? {
            ageMs: Date.now() - c.ts,
            hosts: c.data.docker.hosts.length,
            containers: c.data.docker.containers.length,
          }
        : null,
      lastError: c.lastError,
    };
  },
};
