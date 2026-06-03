// App-state key→value store, backed by Kysely + SQLite (better-sqlite3). Exposes
// the async StateStore contract so a Postgres/MySQL adapter can drop in later.
import { stat } from 'node:fs/promises';

import {
  countApplied,
  runMigrations,
  type Migration,
  type WithMigrations,
} from '../storage/migrations.js';
import { openSqliteKysely } from '../storage/sqlite.js';
import type { StateEntry, StateSnapshot, StateStore, StateStoreStats } from '../storage/types.js';

interface AppStateTable {
  key: string;
  value: string;
  updated_at: number;
}

interface StateDatabase extends WithMigrations {
  app_state: AppStateTable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Strip the per-category descriptive `note` and rename the old
// "Networking (legacy)" category — the vendor-neutral cleanup applied to an
// already-persisted inventory blob.
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

// Ordered migrations. Names map 1:1 to the old `user_version` steps so an
// existing DB reconciles cleanly (v1 -> 001, v2 -> 002).
const MIGRATIONS: Migration<StateDatabase>[] = [
  {
    name: '001_app_state',
    up: async (db) => {
      await db.schema
        .createTable('app_state')
        .ifNotExists()
        .addColumn('key', 'text', (c) => c.primaryKey())
        .addColumn('value', 'text', (c) => c.notNull())
        .addColumn('updated_at', 'integer', (c) => c.notNull())
        .execute();
    },
  },
  {
    name: '002_clean_inventory',
    up: async (db) => {
      const row = await db
        .selectFrom('app_state')
        .select('value')
        .where('key', '=', 'inventory')
        .executeTakeFirst();
      if (!row) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.value);
      } catch {
        return;
      }
      const cleaned = cleanPersistedInventory(parsed);
      if (!cleaned.changed) return;
      // Update value only — leave updated_at so the row's age is preserved.
      await db
        .updateTable('app_state')
        .set({ value: JSON.stringify(cleaned.value) })
        .where('key', '=', 'inventory')
        .execute();
    },
  },
];

export async function openStateDb(dbPath: string): Promise<StateStore> {
  const { db, legacyVersion } = await openSqliteKysely<StateDatabase>(dbPath);
  await runMigrations(db, MIGRATIONS, { legacyVersion });

  return {
    async getAll(): Promise<StateSnapshot> {
      const rows = await db
        .selectFrom('app_state')
        .select(['key', 'value', 'updated_at'])
        .execute();
      const values: Record<string, unknown> = {};
      const updatedAt: Record<string, number> = {};
      for (const row of rows) {
        try {
          values[row.key] = JSON.parse(row.value);
        } catch {
          values[row.key] = null;
        }
        updatedAt[row.key] = row.updated_at;
      }
      return { values, updatedAt };
    },

    async get(key: string): Promise<StateEntry | null> {
      const row = await db
        .selectFrom('app_state')
        .select(['value', 'updated_at'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) return null;
      try {
        return { value: JSON.parse(row.value), updatedAt: row.updated_at };
      } catch {
        return { value: null, updatedAt: row.updated_at };
      }
    },

    async put(key: string, value: unknown): Promise<number> {
      const now = Date.now();
      await db
        .insertInto('app_state')
        .values({ key, value: JSON.stringify(value), updated_at: now })
        .onConflict((oc) =>
          oc.column('key').doUpdateSet((eb) => ({
            value: eb.ref('excluded.value'),
            updated_at: eb.ref('excluded.updated_at'),
          })),
        )
        .execute();
      return now;
    },

    async delete(key: string): Promise<number> {
      const res = await db.deleteFrom('app_state').where('key', '=', key).executeTakeFirst();
      return Number(res.numDeletedRows ?? 0);
    },

    async importBulk(entries: Record<string, unknown>): Promise<number> {
      const keys = Object.keys(entries);
      if (keys.length === 0) return 0;
      const now = Date.now();
      await db.transaction().execute(async (trx) => {
        for (const [key, value] of Object.entries(entries)) {
          await trx
            .insertInto('app_state')
            .values({ key, value: JSON.stringify(value), updated_at: now })
            .onConflict((oc) =>
              oc.column('key').doUpdateSet((eb) => ({
                value: eb.ref('excluded.value'),
                updated_at: eb.ref('excluded.updated_at'),
              })),
            )
            .execute();
        }
      });
      return keys.length;
    },

    async stats(): Promise<StateStoreStats> {
      let fileSize: number | null = null;
      try {
        fileSize = (await stat(dbPath)).size;
      } catch {
        /* ignore */
      }
      const count = await db
        .selectFrom('app_state')
        .select((eb) => eb.fn.countAll().as('n'))
        .executeTakeFirst();
      return {
        path: dbPath,
        fileSize,
        keys: Number(count?.n ?? 0),
        schemaVersion: await countApplied(db),
      };
    },

    async close(): Promise<void> {
      await db.destroy();
    },
  };
}
