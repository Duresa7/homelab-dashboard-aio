import { stat } from 'node:fs/promises';
import type { Generated, Kysely } from 'kysely';

import { autoIdColumn, columnTypes } from '../storage/columns.js';
import type { DbDriver } from '../storage/config.js';
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

interface UsersTable {
  id: Generated<number>;
  username: string;
  display_name: string;
  email: string | null;
  password_hash: string;
  role: string;
  totp_secret: string | null;
  totp_enabled: number;
  recovery_codes: string;
  created_at: number;
  updated_at: number;
  password_changed_at: number;
}

interface SessionsTable {
  id: string;
  token_hash: string;
  user_id: number;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  remember: number;
  ip: string | null;
  user_agent: string | null;
}

export interface StateDatabase extends WithMigrations {
  app_state: AppStateTable;
  users: UsersTable;
  sessions: SessionsTable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inventoryCategoryKey(value: Record<string, unknown>): 'devices' | 'spares' | null {
  if (Array.isArray(value.devices)) return 'devices';
  if (Array.isArray(value.spares)) return 'spares';
  return null;
}

function cleanPersistedInventory(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value)) {
    return { value, changed: false };
  }

  const key = inventoryCategoryKey(value);
  if (!key) return { value, changed: false };

  let changed = false;
  const categories = (value[key] as unknown[]).map((category) => {
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
  return { value: { ...value, [key]: categories }, changed: true };
}

function renamePersistedInventoryDevices(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value) || !Array.isArray(value.spares)) {
    return { value, changed: false };
  }

  const { spares, ...rest } = value;
  return {
    value: {
      ...rest,
      devices: Array.isArray(value.devices) ? value.devices : spares,
    },
    changed: true,
  };
}

export const STATE_MIGRATIONS: Migration<StateDatabase>[] = [
  {
    name: '001_app_state',
    up: async (db, { driver }) => {
      const t = columnTypes(driver);
      await db.schema
        .createTable('app_state')
        .ifNotExists()
        .addColumn('key', t.shortText, (c) => c.primaryKey())
        .addColumn('value', t.text, (c) => c.notNull())
        .addColumn('updated_at', t.bigint, (c) => c.notNull())
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

      await db
        .updateTable('app_state')
        .set({ value: JSON.stringify(cleaned.value) })
        .where('key', '=', 'inventory')
        .execute();
    },
  },
  {
    name: '003_rename_inventory_devices',
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
      const renamed = renamePersistedInventoryDevices(parsed);
      if (!renamed.changed) return;

      await db
        .updateTable('app_state')
        .set({ value: JSON.stringify(renamed.value) })
        .where('key', '=', 'inventory')
        .execute();
    },
  },
  {
    name: '004_users',
    up: async (db, { driver }) => {
      const t = columnTypes(driver);
      await db.schema
        .createTable('users')
        .ifNotExists()
        .addColumn('id', t.id, autoIdColumn(driver))
        .addColumn('username', t.shortText, (c) => c.notNull().unique())
        .addColumn('display_name', t.text, (c) => c.notNull())
        .addColumn('email', t.text)
        .addColumn('password_hash', t.text, (c) => c.notNull())
        .addColumn('role', t.shortText, (c) => c.notNull())
        .addColumn('totp_secret', t.text)
        .addColumn('totp_enabled', t.int, (c) => c.notNull().defaultTo(0))
        .addColumn('recovery_codes', t.text, (c) => c.notNull().defaultTo('[]'))
        .addColumn('created_at', t.bigint, (c) => c.notNull())
        .addColumn('updated_at', t.bigint, (c) => c.notNull())
        .addColumn('password_changed_at', t.bigint, (c) => c.notNull())
        .execute();
    },
  },
  {
    name: '005_sessions',
    up: async (db, { driver }) => {
      const t = columnTypes(driver);
      await db.schema
        .createTable('sessions')
        .ifNotExists()
        .addColumn('id', t.shortText, (c) => c.primaryKey())
        .addColumn('token_hash', t.shortText, (c) => c.notNull().unique())
        .addColumn('user_id', t.int, (c) => c.notNull())
        .addColumn('created_at', t.bigint, (c) => c.notNull())
        .addColumn('last_used_at', t.bigint, (c) => c.notNull())
        .addColumn('expires_at', t.bigint, (c) => c.notNull())
        .addColumn('remember', t.int, (c) => c.notNull().defaultTo(0))
        .addColumn('ip', t.shortText)
        .addColumn('user_agent', t.text)
        .execute();
      await db.schema
        .createIndex('sessions_user_id_idx')
        .ifNotExists()
        .on('sessions')
        .column('user_id')
        .execute();
      await db.schema
        .createIndex('sessions_expires_at_idx')
        .ifNotExists()
        .on('sessions')
        .column('expires_at')
        .execute();
    },
  },
];

export function createStateStore(
  db: Kysely<StateDatabase>,
  driver: DbDriver,
  dbPath: string | null,
): StateStore {
  const upsert = (qc: Kysely<StateDatabase>, key: string, value: unknown, now: number) => {
    const row = { key, value: JSON.stringify(value), updated_at: now };
    if (driver === 'mysql') {
      return qc
        .insertInto('app_state')
        .values(row)
        .onDuplicateKeyUpdate({ value: row.value, updated_at: row.updated_at })
        .execute();
    }
    return qc
      .insertInto('app_state')
      .values(row)
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({ value: row.value, updated_at: row.updated_at }),
      )
      .execute();
  };

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
        updatedAt[row.key] = Number(row.updated_at);
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
        return { value: JSON.parse(row.value), updatedAt: Number(row.updated_at) };
      } catch {
        return { value: null, updatedAt: Number(row.updated_at) };
      }
    },

    async put(key: string, value: unknown): Promise<number> {
      const now = Date.now();
      await upsert(db, key, value, now);
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
          await upsert(trx, key, value, now);
        }
      });
      return keys.length;
    },

    async stats(): Promise<StateStoreStats> {
      let fileSize: number | null = null;
      if (dbPath) {
        try {
          fileSize = (await stat(dbPath)).size;
        } catch {
          void 0;
        }
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

export async function openStateDb(dbPath: string): Promise<StateStore> {
  const { db, legacyVersion } = await openSqliteKysely<StateDatabase>(dbPath);
  await runMigrations(db, STATE_MIGRATIONS, { driver: 'sqlite', legacyVersion });
  return createStateStore(db, 'sqlite', dbPath);
}
