// GPU integration. Runs `nvidia-smi` (locally or over SSH via runRemote) and
// normalizes the CSV into the dashboard's `gpu` slice.
import { runRemote } from '../lib/remote.js';
import { withTtlCache } from '../lib/cache.js';
import { isEnabled } from '../lib/env.js';
import type { GpuApiResponse, GpuSample, GpuWireData, NodeGpu } from '../../../shared/wire.ts';
import { selectionConfig, text, type Provider } from './provider.js';
import { collectPerNode, resolveNodeTargets, type NodeTarget } from './node-targets.js';

const GPU_SSH_USER = process.env.GPU_SSH_USER || 'root';
const GPU_SSH_PORT = Number(process.env.GPU_SSH_PORT) || 22;
const GPU_SSH_KEY_PATH = process.env.GPU_SSH_KEY_PATH || '';
const GPU_CACHE_TTL = Number(process.env.GPU_POLL_INTERVAL) || 5000;

export interface GpuRuntimeConfig {
  enabled: boolean;
  mode?: string;
  sshHost?: string;
}

function configFromEnv(): GpuRuntimeConfig {
  return {
    enabled: isEnabled(process.env.GPU_ENABLED),
    mode: (process.env.GPU_MODE || 'ssh').toLowerCase(),
    sshHost: process.env.GPU_SSH_HOST || '',
  };
}

let config = configFromEnv();

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

function gpuTargets(): NodeTarget[] {
  return resolveNodeTargets({
    targetsJson: process.env.PROXMOX_NODE_TARGETS,
    primaryNode: process.env.PROXMOX_NODE,
    defaults: {
      mode: (config.mode || 'ssh').toLowerCase(),
      host: config.sshHost || '',
      user: GPU_SSH_USER,
      port: GPU_SSH_PORT,
      keyPath: GPU_SSH_KEY_PATH,
    },
  });
}

function runNvidiaSmi(target: NodeTarget) {
  const queryArg = `--query-gpu=${NVIDIA_SMI_FIELDS}`;
  const formatArg = '--format=csv,noheader,nounits';
  return runRemote({
    mode: target.mode,
    host: target.host,
    user: target.user,
    port: target.port,
    keyPath: target.keyPath,
    jumpHost: target.jumpHost,
    jumpUser: target.jumpUser,
    jumpPort: target.jumpPort,
    localCmd: 'nvidia-smi',
    localArgs: [queryArg, formatArg],
    remoteCmd: `nvidia-smi ${queryArg} ${formatArg}`,
  });
}

function parseNvidiaSmiCsv(output: string): GpuSample[] {
  const lines = output.trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const p = line.split(',').map((s) => s.trim());
    const num = (i: number) => {
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

const EMPTY_GPU: GpuWireData = {
  model: '—',
  usage: 0,
  target: 0,
  memUsedGB: 0,
  memTotalGB: 0,
  tempC: 0,
  powerW: 0,
  powerMaxW: 0,
  fanPct: 0,
  gpuClockMHz: 0,
  memClockMHz: 0,
};

function toNodeGpu(node: string, index: number, s: GpuSample): NodeGpu {
  return {
    node,
    index,
    model: s.name,
    usage: s.usage,
    target: s.usage,
    memUsedGB: s.memUsedMB / 1024,
    memTotalGB: Math.round((s.memTotalMB / 1024) * 10) / 10,
    tempC: s.tempC,
    powerW: s.powerW,
    powerMaxW: s.powerMaxW,
    fanPct: s.fanPct,
    gpuClockMHz: s.gpuClockMHz,
    memClockMHz: s.memClockMHz,
  };
}

function stripNode(gpu: NodeGpu): GpuWireData {
  const rest: Partial<NodeGpu> = { ...gpu };
  delete rest.node;
  delete rest.index;
  return rest as GpuWireData;
}

// nvidia-smi being absent (Intel/AMD node) or finding no device is a normal
// "no GPU" outcome, not an outage — distinguish it from genuine connection
// failures so a GPU-less node contributes nothing rather than going `unavailable`.
function isNoGpuError(err: unknown): boolean {
  const e = err as { message?: unknown; stderr?: unknown };
  const text = `${typeof e?.message === 'string' ? e.message : String(err)} ${
    typeof e?.stderr === 'string' ? e.stderr : ''
  }`;
  return /command not found|not found|no devices were found|nvidia-smi has failed|couldn'?t communicate|failed to initialize nvml/i.test(
    text,
  );
}

async function fetchNodeGpus(target: NodeTarget): Promise<NodeGpu[]> {
  let output: string;
  try {
    output = await runNvidiaSmi(target);
  } catch (err) {
    if (isNoGpuError(err)) return []; // reachable, just no NVIDIA GPU
    throw err; // genuine failure → recorded as unavailable
  }
  return parseNvidiaSmiCsv(output).map((sample, index) => toNodeGpu(target.node, index, sample));
}

async function fetchGpuDataRaw(): Promise<GpuApiResponse> {
  const targets = gpuTargets();
  const { results, unavailable } = await collectPerNode(targets, fetchNodeGpus);
  if (results.length === 0) {
    // Nothing responded at all — surface it (preserves single-host 502 behavior).
    throw new Error(
      unavailable.map((u) => `${u.node}: ${u.reason}`).join('; ') || 'no GPU targets configured',
    );
  }
  const gpus = results.flatMap((r) => r.data);
  const primaryNode = targets[0]?.node;
  const primary = gpus.find((g) => g.node === primaryNode) ?? gpus[0];
  return {
    gpu: primary ? stripNode(primary) : EMPTY_GPU,
    gpus,
    ...(unavailable.length ? { unavailable } : {}),
  };
}

const fetchGpuData = withTtlCache(fetchGpuDataRaw, GPU_CACHE_TTL);

// Status descriptor. Includes the SSH fields because the sensors integration
// defaults its own SSH config to the GPU host (they usually target the same box).
export const gpuStatus = {
  enabled: config.enabled,
  configured: config.enabled && ((config.mode || 'ssh') === 'local' || !!config.sshHost),
  mode: (config.mode || 'ssh').toLowerCase(),
  host: config.sshHost || '',
  user: GPU_SSH_USER,
  port: GPU_SSH_PORT,
  keyPath: GPU_SSH_KEY_PATH,
};

export function configureGpu(next: GpuRuntimeConfig): void {
  config = {
    enabled: next.enabled,
    mode: (next.mode || 'ssh').toLowerCase(),
    sshHost: next.sshHost || '',
  };
  fetchGpuData.clear();
  gpuStatus.enabled = config.enabled;
  gpuStatus.configured = config.enabled && (config.mode === 'local' || !!config.sshHost);
  gpuStatus.mode = config.mode || 'ssh';
  gpuStatus.host = config.sshHost || '';
}

/** Liveness probe used by /api/health/live. Probes the primary node only. */
export function probeGpu() {
  const target = gpuTargets()[0];
  if (!target) return Promise.reject(new Error('GPU not configured'));
  return runNvidiaSmi(target);
}

export const gpuProvider: Provider<GpuApiResponse> = {
  id: 'gpu',
  capabilityId: 'gpu',
  logName: 'GPU',
  status: gpuStatus,
  notConfiguredMessage: 'GPU_MODE=ssh but GPU_SSH_HOST is not configured',
  errorLogLevel: 'warn',
  configure(selection) {
    const cfg = selectionConfig(selection);
    configureGpu({
      enabled: !!selection?.enabled,
      mode: text(cfg.mode) || 'ssh',
      sshHost: text(cfg.sshHost) || '',
    });
  },
  fetch: fetchGpuData,
  probe: probeGpu,
  debug() {
    const debugConfig: {
      mode: string;
      host?: string;
      user?: string;
      port?: number;
      keyPath?: string;
    } = { mode: gpuStatus.mode };
    if (gpuStatus.mode === 'ssh') {
      debugConfig.host = gpuStatus.host;
      debugConfig.user = GPU_SSH_USER;
      debugConfig.port = GPU_SSH_PORT;
      debugConfig.keyPath = GPU_SSH_KEY_PATH || '(default)';
    }
    const c = fetchGpuData.peek();
    return {
      config: debugConfig,
      targets: gpuTargets().map((t) => ({
        node: t.node,
        mode: t.mode,
        host: t.host,
        jumpHost: t.jumpHost ?? null,
      })),
      cache: c.data ? { ageMs: Date.now() - c.ts, gpus: c.data.gpus } : null,
      lastError: c.lastError,
    };
  },
};
