import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS syslog_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at INTEGER NOT NULL,
    log_time    INTEGER,
    source_ip   TEXT NOT NULL,
    hostname    TEXT,
    facility    INTEGER,
    severity    INTEGER NOT NULL,
    tag         TEXT,
    message     TEXT NOT NULL,
    raw         TEXT NOT NULL,
    format      TEXT NOT NULL,
    device_kind TEXT NOT NULL,
    category    TEXT NOT NULL,
    extra       TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_received_at ON syslog_events(received_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_severity    ON syslog_events(severity)`,
  `CREATE INDEX IF NOT EXISTS idx_device_kind ON syslog_events(device_kind)`,
  `CREATE INDEX IF NOT EXISTS idx_category    ON syslog_events(category)`,
  `CREATE INDEX IF NOT EXISTS idx_source_ip   ON syslog_events(source_ip)`,
];

const VALID_CATEGORIES = new Set([
  'firewall', 'client', 'ids', 'vpn', 'admin', 'update',
  'system', 'monitoring', 'security', 'threat',
]);
const VALID_DEVICE_KINDS = new Set([
  'gateway', 'ap', 'switch', 'controller', 'unknown',
]);

export async function openSiemDb(dbPath) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  for (const stmt of SCHEMA_STATEMENTS) db.prepare(stmt).run();

  const insertStmt = db.prepare(`
    INSERT INTO syslog_events
      (received_at, log_time, source_ip, hostname, facility, severity, tag,
       message, raw, format, device_kind, category, extra)
    VALUES
      (@received_at, @log_time, @source_ip, @hostname, @facility, @severity, @tag,
       @message, @raw, @format, @device_kind, @category, @extra)
  `);

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM syslog_events`);
  const countSinceStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM syslog_events WHERE received_at >= ?`,
  );
  const lastEventStmt = db.prepare(
    `SELECT MAX(received_at) AS ts FROM syslog_events`,
  );
  const purgeStmt = db.prepare(`DELETE FROM syslog_events WHERE received_at < ?`);
  const replayStmt = db.prepare(
    `SELECT * FROM syslog_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
  );
  const byIdStmt = db.prepare(`SELECT * FROM syslog_events WHERE id = ?`);

  function insertEvent(evt) {
    const row = {
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
    };
    const info = insertStmt.run(row);
    return { id: Number(info.lastInsertRowid), ...row };
  }

  function queryEvents({
    since = null, until = null,
    severity = null,
    deviceKind = null,
    category = null,
    sourceIp = null,
    q = null,
    afterId = null,
    limit = 200,
    order = 'desc',
  } = {}) {
    const where = [];
    const params = [];

    if (since != null) { where.push('received_at >= ?'); params.push(Number(since)); }
    if (until != null) { where.push('received_at <= ?'); params.push(Number(until)); }
    if (afterId != null) { where.push('id > ?'); params.push(Number(afterId)); }

    const severities = parseCsv(severity).map(Number).filter(Number.isFinite);
    if (severities.length) {
      where.push(`severity IN (${severities.map(() => '?').join(',')})`);
      params.push(...severities);
    }

    const kinds = parseCsv(deviceKind).filter((k) => VALID_DEVICE_KINDS.has(k));
    if (kinds.length) {
      where.push(`device_kind IN (${kinds.map(() => '?').join(',')})`);
      params.push(...kinds);
    }

    const cats = parseCsv(category).filter((c) => VALID_CATEGORIES.has(c));
    if (cats.length) {
      where.push(`category IN (${cats.map(() => '?').join(',')})`);
      params.push(...cats);
    }

    if (sourceIp) {
      where.push('source_ip = ?');
      params.push(String(sourceIp));
    }

    if (q) {
      // Search message + raw line so users can grep IPs out of firewall rules.
      const needle = '%' + String(q).replace(/([\\%_])/g, '\\$1') + '%';
      where.push("(message LIKE ? ESCAPE '\\' OR raw LIKE ? ESCAPE '\\')");
      params.push(needle, needle);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = order === 'asc' ? 'ASC' : 'DESC';
    const lim = Math.max(1, Math.min(Number(limit) || 200, 5000));

    const sql = `SELECT * FROM syslog_events ${whereSql} ORDER BY id ${orderSql} LIMIT ?`;
    params.push(lim);
    const rows = db.prepare(sql).all(...params);
    return rows.map(rowToEvent);
  }

  function getStats({ since = Date.now() - 3600_000 } = {}) {
    const bySeverity = db.prepare(
      `SELECT severity, COUNT(*) AS n FROM syslog_events
       WHERE received_at >= ? GROUP BY severity`,
    ).all(since);
    const byCategory = db.prepare(
      `SELECT category, COUNT(*) AS n FROM syslog_events
       WHERE received_at >= ? GROUP BY category`,
    ).all(since);
    const byKind = db.prepare(
      `SELECT device_kind, COUNT(*) AS n FROM syslog_events
       WHERE received_at >= ? GROUP BY device_kind`,
    ).all(since);
    const bySource = db.prepare(
      `SELECT source_ip, COUNT(*) AS n FROM syslog_events
       WHERE received_at >= ? GROUP BY source_ip ORDER BY n DESC LIMIT 20`,
    ).all(since);
    return {
      sinceMs: since,
      bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r.n])),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r.n])),
      byDeviceKind: Object.fromEntries(byKind.map((r) => [r.device_kind, r.n])),
      bySource: bySource.map((r) => ({ ip: r.source_ip, count: r.n })),
    };
  }

  function totals() {
    const total = countStmt.get().n;
    const lastHour = countSinceStmt.get(Date.now() - 3600_000).n;
    const last = lastEventStmt.get().ts;
    return { total, lastHour, lastEventAt: last ?? null };
  }

  function purgeOlderThan(cutoffMs) {
    return purgeStmt.run(cutoffMs).changes;
  }

  function replayAfter(lastId, limit = 500) {
    return replayStmt.all(Number(lastId), Math.max(1, Math.min(limit, 5000))).map(rowToEvent);
  }

  function getById(id) {
    const row = byIdStmt.get(Number(id));
    return row ? rowToEvent(row) : null;
  }

  function close() {
    db.close();
  }

  return {
    insertEvent,
    queryEvents,
    getStats,
    totals,
    purgeOlderThan,
    replayAfter,
    getById,
    close,
  };
}

function parseCsv(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(parseCsv);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

function rowToEvent(row) {
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

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
