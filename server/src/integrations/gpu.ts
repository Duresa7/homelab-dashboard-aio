// GPU integration. Per node it runs one detection script (over SSH, or
// locally) that combines `nvidia-smi` (full NVIDIA metrics), an `lspci` scan
// (vendor/model detection for AMD / Intel / anything without nvidia-smi), and
// a DRM sysfs sweep (best-effort clocks for i915, utilization/VRAM/temp for
// amdgpu), then normalizes everything into the dashboard's `gpu` slice.
import { runRemote } from '../lib/remote.js';
import { withTtlCache } from '../lib/cache.js';
import { isEnabled } from '../lib/env.js';
import type {
  GpuApiResponse,
  GpuSample,
  GpuVendor,
  GpuWireData,
  NodeGpu,
} from '../../../shared/wire.ts';
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

/** Separator between the nvidia-smi / lspci / DRM-sysfs script sections. */
const SECTION = '__GPU_SECTION__';

const QUERY_ARG = `--query-gpu=${NVIDIA_SMI_FIELDS}`;
const FORMAT_ARG = '--format=csv,noheader,nounits';

// Three sections: NVIDIA metrics CSV, PCI display controllers, DRM sysfs rows
// (card|vendor|i915 act/max MHz|amdgpu busy%|vram used/total bytes|temp m°C).
// Ends in `true` so "no GPU anywhere" is exit 0, not a grep failure.
const DETECTION_SCRIPT =
  `nvidia-smi ${QUERY_ARG} ${FORMAT_ARG} 2>/dev/null; ` +
  `echo ${SECTION}; ` +
  `lspci -nn 2>/dev/null | grep -Ei 'vga compatible controller|3d controller|display controller'; ` +
  `echo ${SECTION}; ` +
  `for c in /sys/class/drm/card[0-9]*; do [ -e "$c/device/vendor" ] || continue; ` +
  `echo "$(basename $c)|$(cat $c/device/vendor 2>/dev/null)` +
  `|$(cat $c/gt_act_freq_mhz 2>/dev/null)|$(cat $c/gt_max_freq_mhz 2>/dev/null)` +
  `|$(cat $c/device/gpu_busy_percent 2>/dev/null)` +
  `|$(cat $c/device/mem_info_vram_used 2>/dev/null)|$(cat $c/device/mem_info_vram_total 2>/dev/null)` +
  `|$(cat $c/device/hwmon/hwmon*/temp1_input 2>/dev/null | head -n1)"; done; true`;

// Local mode keeps the plain nvidia-smi invocation (no shell, and the lspci /
// sysfs scan is Linux-specific) — local installs stay NVIDIA-only.
function runDetection(target: NodeTarget) {
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
    localArgs: [QUERY_ARG, FORMAT_ARG],
    remoteCmd: DETECTION_SCRIPT,
  });
}

function vendorFromId(hex: string): GpuVendor {
  const id = hex.replace(/^0x/i, '').toLowerCase();
  if (id === '10de') return 'nvidia';
  if (id === '1002' || id === '1022') return 'amd';
  if (id === '8086') return 'intel';
  return 'unknown';
}

interface PciDisplay {
  vendor: GpuVendor;
  model: string;
}

/**
 * Parse `lspci -nn` display-controller lines, e.g.
 * `00:02.0 VGA compatible controller [0300]: Intel Corporation CoffeeLake-S GT2 [UHD Graphics 630] [8086:3e92]`.
 * Model prefers the marketing name in the trailing brackets when present.
 */
function parseLspciDisplays(output: string): PciDisplay[] {
  const displays: PciDisplay[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/\[[0-9a-f]{4}\]:\s*(.+?)\s*\[([0-9a-f]{4}):([0-9a-f]{4})\]/i);
    if (!m) continue;
    const desc = m[1];
    const marketing = desc.match(/\[([^\]]+)\]\s*$/);
    const model = marketing
      ? marketing[1]
      : desc.replace(/^.*?(?:Corporation|Corp\.|Inc\.|\[AMD\/ATI\])\s+/i, '').trim() || desc;
    displays.push({ vendor: vendorFromId(m[2]), model });
  }
  return displays;
}

// Heuristic: Intel display controllers are iGPUs unless they're Arc/DG
// discrete cards; AMD iGPUs carry APU family or "Graphics" marketing names.
function isIntegrated(vendor: GpuVendor, model: string): boolean {
  if (vendor === 'intel') return !/\b(arc|dg1|dg2|battlemage)\b/i.test(model);
  if (vendor === 'amd') {
    return /\b(vega\s*\d+|graphics|raphael|renoir|cezanne|picasso|rembrandt|phoenix|barcelo|lucienne|van gogh)\b/i.test(
      model,
    );
  }
  return false;
}

interface DrmCard {
  vendor: GpuVendor;
  actMHz: number | null;
  busyPct: number | null;
  vramUsedB: number | null;
  vramTotalB: number | null;
  tempC: number | null;
}

/** Parse the DRM sysfs sweep rows emitted by DETECTION_SCRIPT. */
function parseDrmCards(output: string): DrmCard[] {
  const cards: DrmCard[] = [];
  for (const line of output.split('\n')) {
    const parts = line.trim().split('|');
    if (parts.length < 8) continue;
    const opt = (s: string): number | null => {
      const v = Number(s);
      return s.trim() !== '' && Number.isFinite(v) ? v : null;
    };
    const tempMilliC = opt(parts[7]);
    cards.push({
      vendor: vendorFromId(parts[1]),
      actMHz: opt(parts[2]),
      busyPct: opt(parts[4]),
      vramUsedB: opt(parts[5]),
      vramTotalB: opt(parts[6]),
      tempC: tempMilliC != null ? tempMilliC / 1000 : null,
    });
  }
  return cards;
}

/** A GPU found by PCI scan (AMD/Intel/unknown), with best-effort sysfs metrics. */
function toDetectedGpu(
  node: string,
  index: number,
  display: PciDisplay,
  drm: DrmCard | undefined,
): NodeGpu {
  const GB = 1024 ** 3;
  return {
    node,
    index,
    model: display.model,
    vendor: display.vendor,
    integrated: isIntegrated(display.vendor, display.model),
    metricsAvailable: drm?.busyPct != null,
    usage: drm?.busyPct ?? 0,
    target: drm?.busyPct ?? 0,
    memUsedGB: drm?.vramUsedB != null ? drm.vramUsedB / GB : 0,
    memTotalGB: drm?.vramTotalB != null ? Math.round((drm.vramTotalB / GB) * 10) / 10 : 0,
    tempC: drm?.tempC ?? 0,
    powerW: 0,
    powerMaxW: 0,
    fanPct: 0,
    gpuClockMHz: drm?.actMHz ?? 0,
    memClockMHz: 0,
  };
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
    vendor: 'nvidia',
    integrated: false,
    metricsAvailable: true,
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
    output = await runDetection(target);
  } catch (err) {
    if (isNoGpuError(err)) return []; // reachable, just no NVIDIA GPU (local mode)
    throw err; // genuine failure → recorded as unavailable
  }

  const [nvidiaCsv = '', lspciOut = '', drmOut = ''] = output.split(SECTION);
  const nvidia = parseNvidiaSmiCsv(nvidiaCsv).map((sample, index) =>
    toNodeGpu(target.node, index, sample),
  );

  // NVIDIA cards are already covered (with full metrics) by nvidia-smi; the
  // PCI scan contributes everything else. Best-effort sysfs metrics are
  // matched to PCI devices by vendor (per-card PCI addresses would be exact,
  // but vendor is enough for the common one-iGPU / one-dGPU layouts).
  const others = parseLspciDisplays(lspciOut).filter((d) => d.vendor !== 'nvidia');
  const drmQueues = new Map<GpuVendor, DrmCard[]>();
  for (const card of parseDrmCards(drmOut)) {
    if (card.vendor === 'nvidia') continue;
    const queue = drmQueues.get(card.vendor) ?? [];
    queue.push(card);
    drmQueues.set(card.vendor, queue);
  }
  const detected = others.map((display, i) =>
    toDetectedGpu(target.node, nvidia.length + i, display, drmQueues.get(display.vendor)?.shift()),
  );

  return [...nvidia, ...detected];
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
  return runDetection(target);
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
