import { errorMessage } from '../lib/errors.js';
import { insecureFetch } from '../lib/http.js';
import { assertAllowedHost } from '../lib/net-guard.js';
import net from 'node:net';

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function trimSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

export function normalizeTestBaseUrl(value: unknown): string {
  const raw = trimSlash(str(value));
  if (!raw) throw new Error('base URL is required');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('base URL must be a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('base URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('base URL must not include credentials');
  }
  parsed.hash = '';
  return trimSlash(parsed.toString());
}

interface HttpTest {
  path: string;
  headers: (config: Record<string, unknown>) => Record<string, string>;
}

const HTTP_TESTS: Record<string, HttpTest> = {
  datacenter: {
    path: '/api2/json/version',
    headers: (c) => ({
      Authorization: `PVEAPIToken=${str(c.tokenId)}=${str(c.tokenSecret)}`,
      Accept: 'application/json',
    }),
  },
  network: {
    path: '/proxy/network/integration/v1/sites',
    headers: (c) => ({ 'X-API-Key': str(c.apiKey), Accept: 'application/json' }),
  },
  nas: {
    path: '/proxy/drive/api/v2/storage',
    headers: (c) => ({ 'X-API-Key': str(c.apiKey), Accept: 'application/json' }),
  },
  containers: {
    path: '/api/endpoints',
    headers: (c) => ({ 'X-API-Key': str(c.apiKey), Accept: 'application/json' }),
  },
};

export interface TestResult {
  ok: boolean;
  error?: string;
  message?: string;
  configPatch?: Record<string, unknown>;

  untestable?: boolean;
}

interface ProxmoxDiscoveredNode {
  name: string;
  status: string;
  ip?: string;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanHost(value: unknown): string | undefined {
  const raw = stringOrUndefined(value);
  if (!raw) return undefined;
  return raw.split('/')[0]?.trim() || undefined;
}

function pickNetworkIp(networks: unknown): string | undefined {
  if (!Array.isArray(networks)) return undefined;
  const bridge = networks.find(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      (entry as Record<string, unknown>).active &&
      (entry as Record<string, unknown>).address &&
      (entry as Record<string, unknown>).type === 'bridge',
  );
  const any = bridge ?? networks.find((entry) => entry && typeof entry === 'object');
  return cleanHost(any && typeof any === 'object' ? (any as Record<string, unknown>).address : '');
}

async function canReachTcp(host: string, port = 22, timeoutMs = 450): Promise<boolean> {
  try {
    await assertAllowedHost(host);
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function fetchPveData(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await insecureFetch(`${baseUrl}${path}`, { headers, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  const json = (await res.json()) as { data?: unknown };
  return json.data;
}

async function discoverProxmox(
  baseUrl: string,
  config: Record<string, unknown>,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Pick<TestResult, 'message' | 'configPatch'>> {
  const nodesRaw = await fetchPveData(baseUrl, '/api2/json/nodes', headers, signal);
  if (!Array.isArray(nodesRaw) || nodesRaw.length === 0) return {};

  let clusterRaw: unknown;
  try {
    clusterRaw = await fetchPveData(baseUrl, '/api2/json/cluster/status', headers, signal);
  } catch {
    clusterRaw = null;
  }

  const clusterByName = new Map<string, Record<string, unknown>>();
  if (Array.isArray(clusterRaw)) {
    for (const entry of clusterRaw) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const name = stringOrUndefined(rec.name);
      if (name && rec.type === 'node') clusterByName.set(name, rec);
    }
  }

  const nodes: ProxmoxDiscoveredNode[] = await Promise.all(
    nodesRaw
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map(async (entry) => {
        const name = stringOrUndefined(entry.node) ?? stringOrUndefined(entry.name) ?? '';
        const status = stringOrUndefined(entry.status) ?? 'unknown';
        const clusterEntry = clusterByName.get(name);
        let ip = cleanHost(clusterEntry?.ip) ?? cleanHost(entry.ip);
        if (!ip && name) {
          try {
            ip = pickNetworkIp(
              await fetchPveData(
                baseUrl,
                `/api2/json/nodes/${encodeURIComponent(name)}/network`,
                headers,
                signal,
              ),
            );
          } catch {
            ip = undefined;
          }
        }
        return { name, status, ip };
      }),
  );

  const usableNodes = nodes.filter((node) => node.name);
  if (usableNodes.length === 0) return {};

  const requestedPrimary = stringOrUndefined(config.node);
  const primary =
    usableNodes.find((node) => node.name === requestedPrimary) ??
    usableNodes.find((node) => node.status === 'online') ??
    usableNodes[0];
  const baseHost = new URL(baseUrl).hostname;
  const primaryDiscoveredHost = primary.ip || primary.name;

  const reachability = new Map<string, boolean>();
  await Promise.all(
    usableNodes.map(async (node) => {
      const host = node.ip || node.name;
      reachability.set(node.name, await canReachTcp(host));
    }),
  );
  const primaryReachable = reachability.get(primary.name) === true;
  const primaryHost = primaryReachable ? primaryDiscoveredHost : baseHost;

  const targets: Record<string, Record<string, unknown>> = {};
  for (const node of usableNodes) {
    const host =
      node.name === primary.name && !primaryReachable ? primaryHost : node.ip || node.name;
    const target: Record<string, unknown> = { mode: 'ssh', host };
    if (node.name !== primary.name && !reachability.get(node.name)) {
      target.jumpHost = primaryHost;
    }
    targets[node.name] = target;
  }

  const topology = usableNodes.length > 1 ? `${usableNodes.length}-node cluster` : 'single node';
  return {
    message: `Detected ${topology}; primary node ${primary.name}.`,
    configPatch: {
      node: primary.name,
      nodeTargets: JSON.stringify(targets, null, 2),
    },
  };
}

export async function testIntegration(
  capability: string,
  config: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<TestResult> {
  const test = HTTP_TESTS[capability];
  if (!test) return { ok: true, untestable: true };

  let baseUrl: string;
  try {
    baseUrl = normalizeTestBaseUrl(config.baseUrl);
    // SSRF guard: never let a connection test probe the dashboard's own
    // loopback services or the link-local/metadata range.
    await assertAllowedHost(baseUrl);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = test.headers(config);
    const res = await insecureFetch(`${baseUrl}${test.path}`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() };
    if (capability === 'datacenter') {
      try {
        return {
          ok: true,
          ...(await discoverProxmox(baseUrl, config, headers, controller.signal)),
        };
      } catch {
        return { ok: true };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}
