import { afterEach, describe, expect, it, vi } from 'vitest';

// runRemote is the shell-out edge; mock it so tests drive per-node responses
// without any SSH. The hoisted holder keeps a stable mock across resetModules.
const remoteMock = vi.hoisted(() => ({ runRemote: vi.fn() }));
vi.mock('../lib/remote.js', () => ({ runRemote: remoteMock.runRemote }));

// Real nvidia-smi CSV line (sample GPU) — field order matches gpu.ts.
const GPU_A_CSV = 'Example GPU A, 0, 6461, 11264, 31, 12.44, 275.00, 0, 139, 405';
const GPU_B_CSV = 'Example GPU B, 5, 1000, 24576, 40, 100, 350, 30, 1500, 9000';

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
      throw new Error('bash: nvidia-smi: command not found'); // nodeC: Intel box, no nvidia-smi
    });

    const res = await gpuProvider.fetch();

    expect(res.gpus).toHaveLength(1);
    expect(res.gpus[0]).toMatchObject({
      node: 'node-a',
      index: 0,
      model: 'Example GPU A',
      memTotalGB: 11, // 11264 MB → 11 GB
      tempC: 31,
    });
    expect(res.gpu.model).toBe('Example GPU A'); // legacy primary = nodeA
    expect(res.unavailable).toBeUndefined(); // GPU-less node is normal, not an outage
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
