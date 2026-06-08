// GPU integration. Runs `nvidia-smi` (locally or over SSH via runRemote) and
// normalizes the CSV into the dashboard's `gpu` slice.
import { runRemote } from '../lib/remote.js';
import { withTtlCache } from '../lib/cache.js';
import { isEnabled } from '../lib/env.js';
import type { GpuApiResponse, GpuSample } from '../../../shared/wire.ts';
import { selectionConfig, text, type Provider } from './provider.js';

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

function runNvidiaSmi() {
  const queryArg = `--query-gpu=${NVIDIA_SMI_FIELDS}`;
  const formatArg = '--format=csv,noheader,nounits';
  return runRemote({
    mode: (config.mode || 'ssh').toLowerCase(),
    host: config.sshHost || '',
    user: GPU_SSH_USER,
    port: GPU_SSH_PORT,
    keyPath: GPU_SSH_KEY_PATH,
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

async function fetchGpuDataRaw(): Promise<GpuApiResponse> {
  const output = await runNvidiaSmi();
  const gpus = parseNvidiaSmiCsv(output);
  if (gpus.length === 0) throw new Error('nvidia-smi returned no GPUs');

  const primary = gpus[0];
  return {
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

/** Liveness probe used by /api/health/live. */
export function probeGpu() {
  return runNvidiaSmi();
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
      cache: c.data ? { ageMs: Date.now() - c.ts, gpus: c.data.gpus } : null,
      lastError: c.lastError,
    };
  },
};
