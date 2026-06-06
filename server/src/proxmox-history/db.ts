import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type HistoryEntityType = 'node' | 'guest' | 'storage' | 'cluster';

export interface HistorySampleInput {
  ts: number;
  resolution?: string;
  entityType: HistoryEntityType;
  entityId: string;
  node: string | null;
  metric: string;
  value: number;
}

export interface HistorySeriesPoint {
  t: number;
  v: number;
}

export const NODE_METRICS = new Set(['cpu_pct', 'mem_pct', 'mem_used', 'disk_pct']);
// Only metrics the snapshot actually populates: cpu/mem are live, while guest
// netin/netout/disk were never sourced and stayed flat, so they're omitted.
export const GUEST_METRICS = new Set(['cpu_pct', 'mem_pct']);
export const STORAGE_METRICS = new Set(['used', 'total', 'used_pct']);
export const CLUSTER_METRICS = new Set(['cpu_pct', 'mem_pct', 'storage_pct']);

export function metricIsValid(entityType: string, metric: string): boolean {
  if (entityType === 'node') return NODE_METRICS.has(metric);
  if (entityType === 'guest') return GUEST_METRICS.has(metric);
  if (entityType === 'storage') return STORAGE_METRICS.has(metric);
  if (entityType === 'cluster') return CLUSTER_METRICS.has(metric);
  return false;
}

export function parseHistoryEntity(entity: string): { type: HistoryEntityType; id: string } | null {
  const [type, ...rest] = entity.split(':');
  const id = rest.join(':').trim();
  if (!id || !['node', 'guest', 'storage', 'cluster'].includes(type)) return null;
  return { type: type as HistoryEntityType, id };
}

export class ProxmoxHistoryStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db
      .prepare(
        `create table if not exists proxmox_history_samples (
          id integer primary key autoincrement,
          ts integer not null,
          resolution text not null default 'raw',
          entity_type text not null,
          entity_id text not null,
          node text,
          metric text not null,
          value real not null
        )`,
      )
      .run();
    this.db
      .prepare(
        `create index if not exists idx_proxmox_history_lookup
          on proxmox_history_samples(entity_type, entity_id, metric, resolution, ts)`,
      )
      .run();
  }

  insertSamples(samples: HistorySampleInput[]): number {
    const valid = samples.filter(
      (s) => Number.isFinite(s.value) && metricIsValid(s.entityType, s.metric),
    );
    if (!valid.length) return 0;
    const insert = this.db.prepare(
      `insert into proxmox_history_samples
        (ts, resolution, entity_type, entity_id, node, metric, value)
       values (@ts, @resolution, @entityType, @entityId, @node, @metric, @value)`,
    );
    const tx = this.db.transaction((rows: HistorySampleInput[]) => {
      for (const row of rows) insert.run({ ...row, resolution: row.resolution ?? 'raw' });
    });
    tx(valid);
    return valid.length;
  }

  pruneOlderThan(cutoffMs: number): number {
    const res = this.db.prepare('delete from proxmox_history_samples where ts < ?').run(cutoffMs);
    return Number(res.changes || 0);
  }

  querySeries(opts: {
    entityType: HistoryEntityType;
    entityId: string;
    metric: string;
    from: number;
    to: number;
    points: number;
  }): HistorySeriesPoint[] {
    if (!metricIsValid(opts.entityType, opts.metric)) {
      throw new Error('Invalid Proxmox history metric');
    }
    if (opts.to <= opts.from) return [];
    const bucketMs = Math.max(1, Math.ceil((opts.to - opts.from) / opts.points));
    const rows = this.db
      .prepare(
        `select
          cast(((ts - @from) / @bucketMs) as integer) as bucket,
          min(ts) as first_ts,
          avg(value) as avg_value
        from proxmox_history_samples
        where entity_type = @entityType
          and entity_id = @entityId
          and metric = @metric
          and resolution = 'raw'
          and ts >= @from
          and ts <= @to
        group by bucket
        order by first_ts asc
        limit @limit`,
      )
      .all({ ...opts, bucketMs, limit: opts.points + 1 }) as {
      first_ts: number;
      avg_value: number;
    }[];
    return rows.map((row) => ({ t: Number(row.first_ts), v: Number(row.avg_value) }));
  }

  close(): void {
    this.db.close();
  }
}
