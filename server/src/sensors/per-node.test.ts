import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';

const remoteMock = vi.hoisted(() => ({ runRemote: vi.fn() }));
vi.mock('../lib/remote.js', () => ({ runRemote: remoteMock.runRemote }));

const parseMock = vi.hoisted(() => ({
  parseSensorsJson: vi.fn(),
  parseDiskInventory: vi.fn(() => []),
}));
vi.mock('./parse.js', () => ({
  parseSensorsJson: parseMock.parseSensorsJson,
  parseDiskInventory: parseMock.parseDiskInventory,
}));

import { initSensors } from './index.js';

type StoredHandler = (req: unknown, res: unknown) => unknown;
function makeApp() {
  const routes: Record<string, StoredHandler> = {};
  return {
    routes,
    get(path: string, handler: StoredHandler) {
      routes[path] = handler;
    },
  };
}
function makeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown as { nodes?: Array<{ node: string }>; [k: string]: unknown },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj as typeof this.body;
      return this;
    },
  };
}

const CONFIG = {
  enabled: true,
  mode: 'ssh',
  sshHost: 'fallback',
  sshUser: 'root',
  sshPort: 22,
  sshKeyPath: '',
  cacheTtl: 0,
};

const NODE_A_SENSORS = {
  cpuTempC: 45,
  systemTempC: null,
  systemTempLabel: null,
  cores: [{ name: 'Core 0', tempC: 45 }],
  disks: [],
  memory: [],
  network: [],
  fans: [],
  other: [],
};

async function callSensors() {
  const app = makeApp();
  initSensors(app as unknown as Express, CONFIG);
  const res = makeRes();
  await app.routes['/api/sensors']({}, res);
  return res;
}

beforeEach(() => {
  remoteMock.runRemote.mockReset();
  parseMock.parseSensorsJson.mockReset();
  parseMock.parseDiskInventory.mockReturnValue([]);
  process.env.PROXMOX_NODE_TARGETS = JSON.stringify({
    'node-a': { host: '10' },
    'node-c': { host: '12' },
  });
});

afterEach(() => {
  delete process.env.PROXMOX_NODE_TARGETS;
  delete process.env.PROXMOX_NODE;
});

describe('sensors per-node collection', () => {
  it('attributes readings per node; an empty `sensors -j` is a reachable no-data node', async () => {
    parseMock.parseSensorsJson.mockReturnValue(NODE_A_SENSORS);
    remoteMock.runRemote.mockImplementation(async (opts: { host?: string; remoteCmd?: string }) => {
      if (opts.remoteCmd?.startsWith('sensors')) return opts.host === '10' ? '{"chip":{}}' : '';
      return '{}';
    });

    const res = await callSensors();

    expect(res.statusCode).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    const nodeA = res.body.nodes!.find((n) => n.node === 'node-a') as typeof NODE_A_SENSORS & {
      node: string;
    };
    const nodeC = res.body.nodes!.find((n) => n.node === 'node-c') as typeof NODE_A_SENSORS & {
      node: string;
    };
    expect(nodeA.cpuTempC).toBe(45);
    expect(nodeC.cores).toEqual([]);
    expect(nodeC.cpuTempC).toBeNull();
    expect(res.body.unavailable).toBeUndefined();

    expect((res.body.sensors as typeof NODE_A_SENSORS).cpuTempC).toBe(45);
  });

  it('treats a missing `sensors` command as no-data, not unavailable', async () => {
    parseMock.parseSensorsJson.mockReturnValue(NODE_A_SENSORS);
    remoteMock.runRemote.mockImplementation(async (opts: { host?: string; remoteCmd?: string }) => {
      if (opts.remoteCmd?.startsWith('sensors')) {
        if (opts.host === '10') return '{"chip":{}}';
        throw new Error('bash: sensors: command not found');
      }
      return '{}';
    });

    const res = await callSensors();

    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.unavailable).toBeUndefined();
  });

  it('records an unreachable node under unavailable', async () => {
    parseMock.parseSensorsJson.mockReturnValue(NODE_A_SENSORS);
    remoteMock.runRemote.mockImplementation(async (opts: { host?: string; remoteCmd?: string }) => {
      if (opts.remoteCmd?.startsWith('sensors')) {
        if (opts.host === '10') return '{"chip":{}}';
        throw new Error('ssh: connect to host 12 port 22: Connection timed out');
      }
      return '{}';
    });

    const res = await callSensors();

    expect(res.body.nodes!.map((n) => n.node)).toEqual(['node-a']);
    expect(res.body.unavailable).toEqual([
      { node: 'node-c', reason: expect.stringContaining('Connection timed out') },
    ]);
  });
});
