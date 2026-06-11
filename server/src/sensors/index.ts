import type { Express, Request, Response } from 'express';
import { runRemote } from '../lib/remote.js';
import { errorMessage } from '../lib/errors.js';
import { isDebugEndpointEnabled } from '../lib/env.js';
import { parseSensorsJson, parseDiskInventory, type SensorTree } from './parse.js';
import type { NodeSensors, SensorsApiResponse } from '../../../shared/wire.ts';
import {
  collectPerNode,
  resolveNodeTargets,
  type NodeTarget,
} from '../integrations/node-targets.js';

const EMPTY_SENSORS: SensorTree = {
  cpuTempC: null,
  systemTempC: null,
  systemTempLabel: null,
  cores: [],
  disks: [],
  memory: [],
  network: [],
  fans: [],
  other: [],
};

function stripNodeName(reading: NodeSensors): SensorTree {
  const rest: Partial<NodeSensors> = { ...reading };
  delete rest.node;
  return rest as SensorTree;
}

export interface SensorsConfig {
  enabled: boolean;
  mode: string;
  sshHost: string;
  sshUser: string;
  sshPort: number;
  sshKeyPath: string;
  cacheTtl: number;
}

export function initSensors(app: Express, config: SensorsConfig) {
  let current = { ...config };

  let aggregateCache: { data: SensorsApiResponse; ts: number } | null = null;
  let sensorsLastError: string | null = null;

  function sensorTargets(): NodeTarget[] {
    return resolveNodeTargets({
      targetsJson: process.env.PROXMOX_NODE_TARGETS,
      primaryNode: process.env.PROXMOX_NODE,
      defaults: {
        mode: current.mode,
        host: current.sshHost,
        user: current.sshUser,
        port: current.sshPort,
        keyPath: current.sshKeyPath,
      },
    });
  }

  function runRemoteOn(
    target: NodeTarget,
    localCmd: string,
    localArgs: string[],
    remoteCmd: string,
  ) {
    return runRemote({
      mode: target.mode,
      host: target.host,
      user: target.user,
      port: target.port,
      keyPath: target.keyPath,
      jumpHost: target.jumpHost,
      jumpUser: target.jumpUser,
      jumpPort: target.jumpPort,
      localCmd,
      localArgs,
      remoteCmd,
    });
  }

  function runSensorsOn(target: NodeTarget) {
    return runRemoteOn(target, 'sensors', ['-j'], 'sensors -j');
  }

  function runLsblkOn(target: NodeTarget) {
    const cols = 'NAME,PATH,MODEL,VENDOR,SERIAL,TRAN,TYPE';
    return runRemoteOn(target, 'lsblk', ['-J', '-o', cols], `lsblk -J -o ${cols}`);
  }

  async function fetchDiskInventoryOn(target: NodeTarget) {
    try {
      return parseDiskInventory(await runLsblkOn(target));
    } catch {
      return [];
    }
  }

  function isNoSensorsError(err: unknown): boolean {
    const e = err as { message?: unknown; stderr?: unknown };
    const text = `${typeof e?.message === 'string' ? e.message : String(err)} ${
      typeof e?.stderr === 'string' ? e.stderr : ''
    }`;
    return /command not found|not found|no sensors found|specified sensor/i.test(text);
  }

  async function fetchNodeSensors(target: NodeTarget): Promise<SensorTree> {
    const [raw, diskInventory] = await Promise.all([
      runSensorsOn(target).catch((err: unknown) => {
        if (isNoSensorsError(err)) return '';
        throw err;
      }),
      fetchDiskInventoryOn(target),
    ]);
    if (!raw || !raw.trim()) return EMPTY_SENSORS;
    return parseSensorsJson(raw, diskInventory);
  }

  function runSensors() {
    const target = sensorTargets()[0];
    if (!target) throw new Error('sensors not configured');
    return runSensorsOn(target);
  }

  async function fetchSensorDiskInventory() {
    const target = sensorTargets()[0];
    if (!target) return [];
    return fetchDiskInventoryOn(target);
  }

  async function fetchPerNodeSensors(): Promise<SensorsApiResponse> {
    const now = Date.now();
    if (aggregateCache && now - aggregateCache.ts < current.cacheTtl) return aggregateCache.data;

    const targets = sensorTargets();
    const { results, unavailable } = await collectPerNode(targets, fetchNodeSensors);
    if (results.length === 0) {
      throw new Error(
        unavailable.map((u) => `${u.node}: ${u.reason}`).join('; ') ||
          'no sensor targets configured',
      );
    }

    const nodes: NodeSensors[] = results.map((r) => ({ node: r.node, ...r.data }));
    const primaryNode = targets[0]?.node;
    const primary = nodes.find((n) => n.node === primaryNode) ?? nodes[0];
    const data: SensorsApiResponse = {
      sensors: primary ? stripNodeName(primary) : EMPTY_SENSORS,
      nodes,
      ...(unavailable.length ? { unavailable } : {}),
    };
    aggregateCache = { data, ts: now };
    sensorsLastError = null;
    return data;
  }

  async function fetchSensorsData(): Promise<SensorTree> {
    return (await fetchPerNodeSensors()).sensors;
  }

  app.get('/api/sensors', async (_req: Request, res: Response) => {
    if (!current.enabled) return res.json({ disabled: true });
    if (sensorTargets().length === 0) {
      return res.status(503).json({
        error: 'SENSORS_MODE=ssh but no host configured (set SENSORS_SSH_HOST or GPU_SSH_HOST)',
      });
    }
    try {
      res.json(await fetchPerNodeSensors());
    } catch (err) {
      sensorsLastError = errorMessage(err);
      console.warn(
        `Sensors: ${current.mode} sensors -j failed → ${errorMessage(err).split('\n')[0]}`,
      );
      res.status(502).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/sensors/debug', async (_req: Request, res: Response) => {
    if (!isDebugEndpointEnabled()) return res.status(404).json({ error: 'Not found' });
    if (!current.enabled) return res.json({ disabled: true });
    const cfg: { mode: string; host?: string; user?: string; port?: number; keyPath?: string } = {
      mode: current.mode,
    };
    if (current.mode === 'ssh') {
      cfg.host = current.sshHost;
      cfg.user = current.sshUser;
      cfg.port = current.sshPort;
      cfg.keyPath = current.sshKeyPath || '(default)';
    }
    try {
      const [raw, diskInventory] = await Promise.all([runSensors(), fetchSensorDiskInventory()]);
      res.json({
        config: cfg,
        targets: sensorTargets().map((t) => ({
          node: t.node,
          mode: t.mode,
          host: t.host,
          jumpHost: t.jumpHost ?? null,
        })),
        diskInventory,
        raw: JSON.parse(raw),
        parsed: parseSensorsJson(raw, diskInventory),
        lastError: sensorsLastError,
      });
    } catch (err) {
      res.json({ config: cfg, raw: null, parsed: null, lastError: errorMessage(err) });
    }
  });

  function configure(next: SensorsConfig): void {
    current = { ...next };
    aggregateCache = null;
    sensorsLastError = null;
  }

  function status(): { enabled: boolean; configured: boolean; mode: string; sshHost: string } {
    return {
      enabled: current.enabled,
      configured: current.enabled && (current.mode === 'local' || !!current.sshHost),
      mode: current.mode,
      sshHost: current.sshHost,
    };
  }

  return { runSensors, fetchSensorsData, configure, status };
}
