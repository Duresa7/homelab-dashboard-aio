import Database from 'better-sqlite3';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

interface AppStateRow {
  key: string;
  value: string;
  updated_at: number;
}
interface CountRow {
  n: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanPersistedInventory(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value) || !Array.isArray(value.spares)) {
    return { value, changed: false };
  }

  let changed = false;
  const spares = value.spares.map((category) => {
    if (!isRecord(category)) return category;

    let next = category;
    if (Object.prototype.hasOwnProperty.call(next, 'note')) {
      next = { ...next };
      delete next.note;
      changed = true;
    }
    if (next.name === 'Networking (legacy)') {
      next = { ...next, name: 'Networking' };
      changed = true;
    }
    return next;
  });

  if (!changed) return { value, changed: false };
  return { value: { ...value, spares }, changed: true };
}

function cleanPersistedInventoryRow(db: Database.Database): void {
  const row = db.prepare(`SELECT value FROM app_state WHERE key = ?`).get('inventory') as
    | { value: string }
    | undefined;
  if (!row) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return;
  }

  const cleaned = cleanPersistedInventory(parsed);
  if (!cleaned.changed) return;

  db.prepare(`UPDATE app_state SET value = ? WHERE key = ?`).run(
    JSON.stringify(cleaned.value),
    'inventory',
  );
}

// Ordered schema migrations. The DB's `user_version` pragma records how many
// have run, so the only step for a future schema change is to append a function
// here — no manual SQL on deploy. Existing DBs created before versioning (and
// fresh ones) start at user_version 0; the idempotent v1 CREATE brings both to 1.
// (The client carries its own inventory schema version independently — see
// client/src/lib; the server `user_version` is unrelated to it.)
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // v1 — initial app_state table.
  (db) => {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS app_state (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ).run();
  },
  // v2 — remove category-level inventory prose and the old "(legacy)" label.
  (db) => {
    cleanPersistedInventoryRow(db);
  },
];

function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const apply = db.transaction(() => {
      MIGRATIONS[v](db);
      db.pragma(`user_version = ${v + 1}`);
    });
    apply();
  }
}

export async function openStateDb(dbPath: string) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  migrate(db);

  const getAllStmt = db.prepare(`SELECT key, value, updated_at FROM app_state`);
  const getOneStmt = db.prepare(`SELECT value, updated_at FROM app_state WHERE key = ?`);
  const upsertStmt = db.prepare(`
    INSERT INTO app_state (key, value, updated_at) VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const deleteStmt = db.prepare(`DELETE FROM app_state WHERE key = ?`);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM app_state`);
  const upsertMany = db.transaction((entries: [string, unknown][]) => {
    const now = Date.now();
    for (const [key, value] of entries) {
      upsertStmt.run({ key, value: JSON.stringify(value), updated_at: now });
    }
  });

  function getAll() {
    const rows = getAllStmt.all() as AppStateRow[];
    const out: Record<string, unknown> = {};
    const meta: Record<string, number> = {};
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

  function get(key: string) {
    const row = getOneStmt.get(key) as { value: string; updated_at: number } | undefined;
    if (!row) return null;
    try {
      return { value: JSON.parse(row.value), updatedAt: row.updated_at };
    } catch {
      return { value: null, updatedAt: row.updated_at };
    }
  }

  function put(key: string, value: unknown) {
    const now = Date.now();
    upsertStmt.run({ key, value: JSON.stringify(value), updated_at: now });
    return now;
  }

  function del(key: string) {
    return deleteStmt.run(key).changes;
  }

  function importBulk(entries: Record<string, unknown>) {
    upsertMany(Object.entries(entries));
    return Object.keys(entries).length;
  }

  async function stats() {
    let fileSize: number | null = null;
    try {
      const s = await stat(dbPath);
      fileSize = s.size;
    } catch {
      /* ignore */
    }
    return {
      path: dbPath,
      fileSize,
      keys: (countStmt.get() as CountRow).n,
      schemaVersion: db.pragma('user_version', { simple: true }) as number,
    };
  }

  function close() {
    db.close();
  }

  return { getAll, get, put, delete: del, importBulk, stats, close };
}
