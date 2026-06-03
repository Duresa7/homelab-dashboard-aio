// Syslog/SIEM store, backed by Kysely + SQLite (better-sqlite3). Exposes the
// async SiemStore contract. SQLite LIKE is case-insensitive by default, matching
// the prior behavior; the Postgres adapter (issue 03) normalizes its own search.
import { sql, type SqlBool } from 'kysely';

import { runMigrations, type Migration, type WithMigrations } from '../storage/migrations.js';
import { openSqliteKysely } from '../storage/sqlite.js';
import type { SiemStats, SiemStore, SiemTotals } from '../storage/types.js';
import type {
  InsertEventInput,
  QueryEventsOpts,
  StoredEvent,
  SyslogEvent,
  SyslogRow,
} from './types.js';

// Re-export the event types so existing imports (`from './db.js'`) keep working.
export type { InsertEventInput, QueryEventsOpts, StoredEvent, SyslogEvent, SyslogRow };

interface SyslogEventsTable {
  id: import('kysely').Generated<number>;
  received_at: number;
  log_time: number | null;
  source_ip: string;
  hostname: string | null;
  facility: number | null;
  severity: number;
  tag: string | null;
  message: string;
  raw: string;
  format: string;
  device_kind: string;
  category: string;
  extra: string | null;
}

interface SiemDatabase extends WithMigrations {
  syslog_events: SyslogEventsTable;
}

const VALID_CATEGORIES = new Set([
  'firewall',
  'client',
  'ids',
  'vpn',
  'admin',
  'update',
  'system',
  'monitoring',
  'security',
  'threat',
]);
const VALID_DEVICE_KINDS = new Set(['gateway', 'ap', 'switch', 'controller', 'unknown']);

const MIGRATIONS: Migration<SiemDatabase>[] = [
  {
    name: '001_syslog_events',
    up: async (db) => {
      await db.schema
        .createTable('syslog_events')
        .ifNotExists()
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('received_at', 'integer', (c) => c.notNull())
        .addColumn('log_time', 'integer')
        .addColumn('source_ip', 'text', (c) => c.notNull())
        .addColumn('hostname', 'text')
        .addColumn('facility', 'integer')
        .addColumn('severity', 'integer', (c) => c.notNull())
        .addColumn('tag', 'text')
        .addColumn('message', 'text', (c) => c.notNull())
        .addColumn('raw', 'text', (c) => c.notNull())
        .addColumn('format', 'text', (c) => c.notNull())
        .addColumn('device_kind', 'text', (c) => c.notNull())
        .addColumn('category', 'text', (c) => c.notNull())
        .addColumn('extra', 'text')
        .execute();
      const indexes: [string, keyof SyslogEventsTable][] = [
        ['idx_received_at', 'received_at'],
        ['idx_severity', 'severity'],
        ['idx_device_kind', 'device_kind'],
        ['idx_category', 'category'],
        ['idx_source_ip', 'source_ip'],
      ];
      for (const [name, column] of indexes) {
        await db.schema
          .createIndex(name)
          .ifNotExists()
          .on('syslog_events')
          .column(column)
          .execute();
      }
    },
  },
];

function parseCsv(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(parseCsv);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowToEvent(row: SyslogRow): SyslogEvent {
  return {
    id: row.id,
    receivedAt: row.received_at,
    logTime: row.log_time,
    sourceIp: row.source_ip,
    hostname: row.hostname,
    facility: row.facility,
    severity: row.severity,
    tag: row.tag,
    message: row.message,
    raw: row.raw,
    format: row.format,
    deviceKind: row.device_kind,
    category: row.category,
    extra: row.extra ? safeJsonParse(row.extra) : null,
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function openSiemDb(dbPath: string): Promise<SiemStore> {
  const { db, legacyVersion } = await openSqliteKysely<SiemDatabase>(dbPath);
  await runMigrations(db, MIGRATIONS, { legacyVersion });

  return {
    async insertEvent(evt: InsertEventInput): Promise<StoredEvent> {
      const inserted = await db
        .insertInto('syslog_events')
        .values({
          received_at: evt.receivedAt,
          log_time: evt.logTime ?? null,
          source_ip: evt.sourceIp,
          hostname: evt.hostname ?? null,
          facility: evt.facility ?? null,
          severity: evt.severity,
          tag: evt.tag ?? null,
          message: evt.message,
          raw: evt.raw,
          format: evt.format,
          device_kind: evt.deviceKind,
          category: evt.category,
          extra: evt.extra ? JSON.stringify(evt.extra) : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return inserted as StoredEvent;
    },

    async queryEvents(opts: QueryEventsOpts = {}): Promise<SyslogEvent[]> {
      const {
        since = null,
        until = null,
        severity = null,
        deviceKind = null,
        category = null,
        sourceIp = null,
        q = null,
        afterId = null,
        limit = 200,
        order = 'desc',
      } = opts;

      let qb = db.selectFrom('syslog_events').selectAll();

      if (since != null) qb = qb.where('received_at', '>=', Number(since));
      if (until != null) qb = qb.where('received_at', '<=', Number(until));
      if (afterId != null) qb = qb.where('id', '>', Number(afterId));

      const severities = parseCsv(severity).map(Number).filter(Number.isFinite);
      if (severities.length) qb = qb.where('severity', 'in', severities);

      const kinds = parseCsv(deviceKind).filter((k) => VALID_DEVICE_KINDS.has(k));
      if (kinds.length) qb = qb.where('device_kind', 'in', kinds);

      const cats = parseCsv(category).filter((c) => VALID_CATEGORIES.has(c));
      if (cats.length) qb = qb.where('category', 'in', cats);

      if (sourceIp) qb = qb.where('source_ip', '=', String(sourceIp));

      if (q) {
        // Search message + raw so users can grep IPs out of firewall rules.
        // Escape LIKE wildcards in the term and declare the escape char.
        const needle = '%' + String(q).replace(/([\\%_])/g, '\\$1') + '%';
        qb = qb.where(
          sql<SqlBool>`(message like ${needle} escape '\\' or raw like ${needle} escape '\\')`,
        );
      }

      const lim = Math.max(1, Math.min(Number(limit) || 200, 5000));
      const rows = await qb
        .orderBy('id', order === 'asc' ? 'asc' : 'desc')
        .limit(lim)
        .execute();
      return rows.map((row) => rowToEvent(row as SyslogRow));
    },

    async getStats({ since = Date.now() - 3600_000 }: { since?: number } = {}): Promise<SiemStats> {
      const groupCount = async <K extends keyof SyslogEventsTable>(column: K) =>
        db
          .selectFrom('syslog_events')
          .select((eb) => [column, eb.fn.countAll().as('n')])
          .where('received_at', '>=', since)
          .groupBy(column)
          .execute();

      const [bySeverity, byCategory, byKind] = await Promise.all([
        groupCount('severity'),
        groupCount('category'),
        groupCount('device_kind'),
      ]);
      const bySource = await db
        .selectFrom('syslog_events')
        .select((eb) => ['source_ip', eb.fn.countAll().as('n')])
        .where('received_at', '>=', since)
        .groupBy('source_ip')
        .orderBy('n', 'desc')
        .limit(20)
        .execute();

      return {
        sinceMs: since,
        bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, Number(r.n)])),
        byCategory: Object.fromEntries(byCategory.map((r) => [r.category, Number(r.n)])),
        byDeviceKind: Object.fromEntries(byKind.map((r) => [r.device_kind, Number(r.n)])),
        bySource: bySource.map((r) => ({ ip: r.source_ip, count: Number(r.n) })),
      };
    },

    async totals(): Promise<SiemTotals> {
      const totalRow = await db
        .selectFrom('syslog_events')
        .select((eb) => eb.fn.countAll().as('n'))
        .executeTakeFirst();
      const lastHourRow = await db
        .selectFrom('syslog_events')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('received_at', '>=', Date.now() - 3600_000)
        .executeTakeFirst();
      const lastRow = await db
        .selectFrom('syslog_events')
        .select((eb) => eb.fn.max('received_at').as('ts'))
        .executeTakeFirst();
      return {
        total: Number(totalRow?.n ?? 0),
        lastHour: Number(lastHourRow?.n ?? 0),
        lastEventAt: lastRow?.ts != null ? Number(lastRow.ts) : null,
      };
    },

    async purgeOlderThanChunk(cutoffMs: number, chunkSize = 1000): Promise<number> {
      // Chunked delete so a huge purge can't block the event loop; the caller
      // yields between chunks. Delete by id from a bounded sub-select.
      const res = await db
        .deleteFrom('syslog_events')
        .where('id', 'in', (eb) =>
          eb
            .selectFrom('syslog_events')
            .select('id')
            .where('received_at', '<', cutoffMs)
            .limit(chunkSize),
        )
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0);
    },

    async replayAfter(lastId: number | string, limit = 500): Promise<SyslogEvent[]> {
      const rows = await db
        .selectFrom('syslog_events')
        .selectAll()
        .where('id', '>', Number(lastId))
        .orderBy('id', 'asc')
        .limit(Math.max(1, Math.min(limit, 5000)))
        .execute();
      return rows.map((row) => rowToEvent(row as SyslogRow));
    },

    async getById(id: number | string): Promise<SyslogEvent | null> {
      const row = await db
        .selectFrom('syslog_events')
        .selectAll()
        .where('id', '=', Number(id))
        .executeTakeFirst();
      return row ? rowToEvent(row as SyslogRow) : null;
    },

    async close(): Promise<void> {
      await db.destroy();
    },
  };
}
