import { afterEach, describe, expect, it, vi } from 'vitest';

const remoteMock = vi.hoisted(() => ({ runRemote: vi.fn() }));
vi.mock('../lib/remote.js', () => ({ runRemote: remoteMock.runRemote }));

const GPU_A_CSV = 'Example GPU A, 0, 6461, 11264, 31, 12.44, 275.00, 0, 139, 405';
const GPU_B_CSV = 'Example GPU B, 5, 1000, 24576, 40, 100, 350, 30, 1500, 9000';

const SEC = '__GPU_SECTION__';
const NVIDIA_NODE_OUT =
  `NVIDIA GeForce GTX 1080 Ti, 0, 6461, 11264, 31, 12.54, 275.00, 0, 139, 405\n` +
  `${SEC}\n` +
  `2b:00.0 VGA compatible controller [0300]: NVIDIA Corporation GP102 [GeForce GTX 1080 Ti] [10de:1b06] (rev a1)\n` +
  `${SEC}\n` +
  `card0|0x10de||||||\n`;
const INTEL_IGPU_OUT =
  `${SEC}\n` +
  `00:02.0 VGA compatible controller [0300]: Intel Corporation CoffeeLake-S GT2 [UHD Graphics 630] [8086:3e92]\n` +
  `${SEC}\n` +
  `card1|0x8086|350|1100||||\n`;
const AMD_DGPU_OUT =
  `${SEC}\n` +
  `03:00.0 VGA compatible controller [0300]: Advanced Micro Devices, Inc. [AMD/ATI] Navi 23 [Radeon RX 6600] [1002:73ff] (rev c1)\n` +
  `${SEC}\n` +
  `card0|0x1002|||37|2147483648|8589934592|56000\n`;

const ENV_KEYS = [
  'GPU_ENABLED',
  'GPU_MODE',
  'GPU_SSH_HOST',
  'GPU_SSH_USER',
  'GPU_SSH_PORT',
  'GPU_SSH_KEY_PATH',
  'PROXMOX_NODE',
  'PROXMOX_NODE_TARGETS',
];

async function loadGpu(env: Record<string, string>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  vi.resetModules();
  remoteMock.runRemote.mockReset();
  return import('./gpu.js');
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('GPU per-node collection', () => {
  it('attributes each GPU to its node; a GPU-less node contributes nothing (not unavailable)', async () => {
    const { gpuProvider } = await loadGpu({
      GPU_ENABLED: 'true',
      GPU_MODE: 'ssh',
      GPU_SSH_HOST: '192.0.2.10',
      PROXMOX_NODE: 'node-a',
      PROXMOX_NODE_TARGETS: JSON.stringify({
        'node-a': { host: '192.0.2.10' },
        'node-c': { host: '192.0.2.12', jumpHost: '192.0.2.10' },
      }),
    });
    remoteMock.runRemote.mockImplementation(async (opts: { host?: string }) => {
      if (opts.host === '192.0.2.10') return `${GPU_A_CSV}\n`;
      throw new Error('bash: nvidia-smi: command not found');
    });

    const res = await gpuProvider.fetch();

    expect(res.gpus).toHaveLength(1);
    expect(res.gpus[0]).toMatchObject({
      node: 'node-a',
      index: 0,
      model: 'Example GPU A',
      memTotalGB: 11,
      tempC: 31,
    });
    expect(res.gpu.model).toBe('Example GPU A');
    expect(res.unavailable).toBeUndefined();
  });

  it('records an unreachable node under unavailable while keeping reachable ones', async () => {
    const { gpuProvider } = await loadGpu({
      GPU_ENABLED: 'true',
      GPU_MODE: 'ssh',
      GPU_SSH_HOST: '192.0.2.10',
      PROXMOX_NODE: 'node-a',
      PROXMOX_NODE_TARGETS: JSON.stringify({
        'node-a': { host: '192.0.2.10' },
        'node-b': { host: '192.0.2.11' },
      }),
    });
    remoteMock.runRemote.mockImplementation(async (opts: { host?: string }) => {
      if (opts.host === '192.0.2.10') return `${GPU_A_CSV}\n`;
      throw new Error('ssh: connect to host 192.0.2.11 port 22: Connection timed out');
    });

    const res = await gpuProvider.fetch();

    expect(res.gpus.map((g) => g.node)).toEqual(['node-a']);
    expect(res.unavailable).toEqual([
      { node: 'node-b', reason: expect.stringContaining('Connection timed out') },
    ]);
  });

  it('indexes multiple GPUs on the same node', async () => {
    const { gpuProvider } = await loadGpu({
      GPU_ENABLED: 'true',
      GPU_MODE: 'ssh',
      GPU_SSH_HOST: 'h',
      PROXMOX_NODE: 'gpubox',
    });
    remoteMock.runRemote.mockResolvedValue(`${GPU_A_CSV}\n${GPU_B_CSV}\n`);

    const res = await gpuProvider.fetch();

    expect(res.gpus).toHaveLength(2);
    expect(res.gpus.map((g) => g.index)).toEqual([0, 1]);
    expect(res.gpus.every((g) => g.node === 'gpubox')).toBe(true);
  });

  it('detects NVIDIA via nvidia-smi and an Intel iGPU via the PCI scan', async () => {
    const { gpuProvider } = await loadGpu({
      GPU_ENABLED: 'true',
      GPU_MODE: 'ssh',
      GPU_SSH_HOST: '192.0.2.10',
      PROXMOX_NODE: 'node-a',
      PROXMOX_NODE_TARGETS: JSON.stringify({
        'node-a': { host: '192.0.2.10' },
        'node-b': { host: '192.0.2.11', jumpHost: '192.0.2.10' },
      }),
    });
    remoteMock.runRemote.mockImplementation(async (opts: { host?: string }) =>
      opts.host === '192.0.2.10' ? NVIDIA_NODE_OUT : INTEL_IGPU_OUT,
    );

    const res = await gpuProvider.fetch();

    expect(res.gpus).toHaveLength(2);
    expect(res.gpus[0]).toMatchObject({
      node: 'node-a',
      model: 'NVIDIA GeForce GTX 1080 Ti',
      vendor: 'nvidia',
      integrated: false,
      metricsAvailable: true,
      tempC: 31,
    });

    expect(res.gpus.filter((g) => g.node === 'node-a')).toHaveLength(1);
    expect(res.gpus[1]).toMatchObject({
      node: 'node-b',
      model: 'UHD Graphics 630',
      vendor: 'intel',
      integrated: true,
      metricsAvailable: false,
      gpuClockMHz: 350,
      usage: 0,
    });
  });

  it('maps amdgpu sysfs metrics onto a detected AMD card', async () => {
    const { gpuProvider } = await loadGpu({
      GPU_ENABLED: 'true',
      GPU_MODE: 'ssh',
      GPU_SSH_HOST: '192.0.2.10',
      PROXMOX_NODE: 'node-a',
    });
    remoteMock.runRemote.mockResolvedValue(AMD_DGPU_OUT);

    const res = await gpuProvider.fetch();

    expect(res.gpus).toHaveLength(1);
    expect(res.gpus[0]).toMatchObject({
      model: 'Radeon RX 6600',
      vendor: 'amd',
      integrated: false,
      metricsAvailable: true,
      usage: 37,
      memUsedGB: 2,
      memTotalGB: 8,
      tempC: 56,
    });
  });

  it('throws (→ 502) when no node responds at all', async () => {
    const { gpuProvider } = await loadGpu({
      GPU_ENABLED: 'true',
      GPU_MODE: 'ssh',
      GPU_SSH_HOST: '192.0.2.99',
      PROXMOX_NODE: 'pve',
    });
    remoteMock.runRemote.mockRejectedValue(new Error('Connection timed out'));

    await expect(gpuProvider.fetch()).rejects.toThrow(/pve|timed out/i);
  });
});
