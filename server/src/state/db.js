import Database from 'better-sqlite3';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS metrics (
    ts          INTEGER NOT NULL,
    integration TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       REAL,
    value_json  TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_metrics_lookup ON metrics(integration, key, ts DESC)`,
];

export async function openStateDb(dbPath) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  for (const stmt of SCHEMA_STATEMENTS) db.prepare(stmt).run();

  const getAllStmt   = db.prepare(`SELECT key, value, updated_at FROM app_state`);
  const getOneStmt   = db.prepare(`SELECT value, updated_at FROM app_state WHERE key = ?`);
  const upsertStmt   = db.prepare(`
    INSERT INTO app_state (key, value, updated_at) VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const deleteStmt   = db.prepare(`DELETE FROM app_state WHERE key = ?`);
  const countStmt    = db.prepare(`SELECT COUNT(*) AS n FROM app_state`);
  const metricsCount = db.prepare(`SELECT COUNT(*) AS n FROM metrics`);
  const upsertMany   = db.transaction((entries) => {
    const now = Date.now();
    for (const [key, value] of entries) {
      upsertStmt.run({ key, value: JSON.stringify(value), updated_at: now });
    }
  });

  function getAll() {
    const rows = getAllStmt.all();
    const out = {};
    const meta = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        out[row.key] = null;
      }
      meta[row.key] = row.updated_at;
    }
    return { values: out, updatedAt: meta };
  }

  function get(key) {
    const row = getOneStmt.get(key);
    if (!row) return null;
    try {
      return { value: JSON.parse(row.value), updatedAt: row.updated_at };
    } catch {
      return { value: null, updatedAt: row.updated_at };
    }
  }

  function put(key, value) {
    const now = Date.now();
    upsertStmt.run({ key, value: JSON.stringify(value), updated_at: now });
    return now;
  }

  function del(key) {
    return deleteStmt.run(key).changes;
  }

  function importBulk(entries) {
    upsertMany(Object.entries(entries));
    return Object.keys(entries).length;
  }

  async function stats() {
    let fileSize = null;
    try {
      const s = await stat(dbPath);
      fileSize = s.size;
    } catch { /* ignore */ }
    return {
      path: dbPath,
      fileSize,
      keys: countStmt.get().n,
      metricsRows: metricsCount.get().n,
    };
  }

  function close() {
    db.close();
  }

  return { getAll, get, put, delete: del, importBulk, stats, close };
}
