import type { Express, Request, Response } from 'express';
import path from 'node:path';

import { isEnabled } from '../lib/env.js';
import { errorMessage } from '../lib/errors.js';
import { fetchProxmoxSnapshot, proxmoxStatus } from '../integrations/proxmox.js';
import {
  metricIsValid,
  parseHistoryEntity,
  ProxmoxHistoryStore,
  type HistorySampleInput,
} from './db.js';

const DEFAULT_HISTORY_PATH = path.resolve('data', 'proxmox-history.sqlite');
const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_RETENTION_MS = 48 * 60 * 60 * 1000;

export interface ProxmoxHistoryHandle {
  store: ProxmoxHistoryStore;
  shutdown(): void;
  sampleNow(): Promise<number>;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type SnapshotNode = {
  name?: unknown;
  cpu?: unknown;
  ram?: unknown;
  ramUsedGB?: unknown;
  disk?: unknown;
};
type SnapshotGuest = { id?: unknown; node?: unknown; cpu?: unknown; ram?: unknown };
type SnapshotStorage = {
  name?: unknown;
  node?: unknown;
  shared?: unknown;
  usedTB?: unknown;
  totalTB?: unknown;
};
type SnapshotCluster = { cpuPct?: unknown; memPct?: unknown; storagePct?: unknown };
export interface ProxmoxSnapshot {
  proxmox?: {
    nodes?: SnapshotNode[];
    vms?: SnapshotGuest[];
    storages?: SnapshotStorage[];
    cluster?: SnapshotCluster;
  };
}

export function samplesFromSnapshot(
  snapshot: ProxmoxSnapshot | null | undefined,
  ts = Date.now(),
): HistorySampleInput[] {
  const p = snapshot?.proxmox;
  if (!p) return [];
  const samples: HistorySampleInput[] = [];
  const push = (
    entityType: HistorySampleInput['entityType'],
    entityId: string,
    node: string | null,
    metric: string,
    value: unknown,
  ) => {
    const n = finite(value);
    if (n == null) return;
    samples.push({ ts, entityType, entityId, node, metric, value: n });
  };

  for (const node of p.nodes ?? []) {
    const name = String(node.name ?? '');
    if (!name) continue;
    push('node', name, name, 'cpu_pct', node.cpu);
    push('node', name, name, 'mem_pct', node.ram);
    push('node', name, name, 'mem_used', node.ramUsedGB);
    push('node', name, name, 'disk_pct', node.disk);
  }
  for (const guest of p.vms ?? []) {
    const id = String(guest.id ?? '');
    if (!id) continue;
    const node = guest.node == null ? null : String(guest.node);
    push('guest', id, node, 'cpu_pct', guest.cpu);
    push('guest', id, node, 'mem_pct', guest.ram);
  }
  for (const storage of p.storages ?? []) {
    const name = String(storage.name ?? '');
    if (!name) continue;
    const node = storage.node == null ? null : String(storage.node);
    const shared = Boolean(storage.shared);
    const id = shared ? name : `${node ?? ''}:${name}`;
    const usedTB = Number(storage.usedTB) || 0;
    const totalTB = Number(storage.totalTB) || 0;
    const usedPct = totalTB > 0 ? (usedTB / totalTB) * 100 : 0;
    push('storage', id, node, 'used', usedTB);
    push('storage', id, node, 'total', totalTB);
    push('storage', id, node, 'used_pct', usedPct);
  }
  if (p.cluster) {
    push('cluster', 'all', null, 'cpu_pct', p.cluster.cpuPct);
    push('cluster', 'all', null, 'mem_pct', p.cluster.memPct);
    push('cluster', 'all', null, 'storage_pct', p.cluster.storagePct);
  }
  return samples;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function initProxmoxHistory(app: Express): ProxmoxHistoryHandle {
  const store = new ProxmoxHistoryStore(
    process.env.PROXMOX_HISTORY_DB_PATH || DEFAULT_HISTORY_PATH,
  );
  const intervalMs = clampNumber(
    process.env.PROXMOX_HISTORY_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    5_000,
    60 * 60 * 1000,
  );
  const retentionMs = clampNumber(
    process.env.PROXMOX_HISTORY_RETENTION_MS,
    DEFAULT_RETENTION_MS,
    60 * 60 * 1000,
    30 * 24 * 60 * 60 * 1000,
  );
  let timer: NodeJS.Timeout | null = null;

  const sampleNow = async (): Promise<number> => {
    if (!proxmoxStatus.enabled || !proxmoxStatus.configured) return 0;
    const snapshot = await fetchProxmoxSnapshot();
    const count = store.insertSamples(samplesFromSnapshot(snapshot));
    store.pruneOlderThan(Date.now() - retentionMs);
    return count;
  };

  const enabled = isEnabled(process.env.PROXMOX_HISTORY_ENABLED, true);
  if (enabled && process.env.NODE_ENV !== 'test') {
    void sampleNow().catch((err) =>
      console.warn(`Proxmox history: sample failed - ${errorMessage(err)}`),
    );
    timer = setInterval(() => {
      void sampleNow().catch((err) =>
        console.warn(`Proxmox history: sample failed - ${errorMessage(err)}`),
      );
    }, intervalMs);
  }

  app.get('/api/proxmox/history', (req: Request, res: Response) => {
    if (!proxmoxStatus.enabled) return res.status(503).json({ error: 'Proxmox disabled' });
    if (!proxmoxStatus.configured) return res.status(503).json({ error: 'Proxmox not configured' });
    const entity = parseHistoryEntity(String(req.query.entity ?? ''));
    const metric = String(req.query.metric ?? '');
    if (!entity || !metricIsValid(entity.type, metric)) {
      return res.status(400).json({ error: 'Invalid Proxmox history entity or metric' });
    }
    const now = Date.now();
    const to = clampNumber(req.query.to, now, now - 30 * 24 * 60 * 60 * 1000, now + 60_000);
    const from = clampNumber(
      req.query.from,
      to - 60 * 60 * 1000,
      to - 30 * 24 * 60 * 60 * 1000,
      to,
    );
    const points = Math.round(clampNumber(req.query.points, 96, 12, 600));
    res.json({
      series: store.querySeries({
        entityType: entity.type,
        entityId: entity.id,
        metric,
        from,
        to,
        points,
      }),
    });
  });

  return {
    store,
    sampleNow,
    shutdown() {
      if (timer) clearInterval(timer);
      store.close();
    },
  };
}
