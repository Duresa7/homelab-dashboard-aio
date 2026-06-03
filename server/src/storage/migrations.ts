// Portable migration runner. Tracks applied migrations in a `schema_migrations`
// table driven through Kysely (works on SQLite/Postgres/MySQL) instead of
// SQLite's `user_version` pragma. Reconciliation lets a pre-versioning SQLite
// DB carry over: the first `legacyVersion` migrations are marked applied without
// re-running, so existing installs neither re-run DDL nor lose data.
import type { Kysely } from 'kysely';

import { columnTypes } from './columns.js';
import type { DbDriver } from './config.js';

export interface SchemaMigrationsTable {
  name: string;
  applied_at: number;
}

/** A database the runner can manage must carry the tracking table. */
export interface WithMigrations {
  schema_migrations: SchemaMigrationsTable;
}

export interface MigrationContext {
  driver: DbDriver;
}

export interface Migration<DB extends WithMigrations> {
  /** Sortable, stable name, e.g. `001_app_state`. Lexicographic = run order. */
  name: string;
  up: (db: Kysely<DB>, ctx: MigrationContext) => Promise<void>;
}

export async function runMigrations<DB extends WithMigrations>(
  db: Kysely<DB>,
  migrations: Migration<DB>[],
  opts: { driver: DbDriver; legacyVersion?: number },
): Promise<void> {
  const { driver } = opts;
  const types = columnTypes(driver);
  // Kysely can't resolve table types against a generic DB param, so address the
  // tracking table through a concrete view. The per-migration `up` still gets
  // the caller's fully-typed Kysely<DB>.
  const tracker = db as unknown as Kysely<WithMigrations>;

  await tracker.schema
    .createTable('schema_migrations')
    .ifNotExists()
    .addColumn('name', types.shortText, (c) => c.primaryKey())
    .addColumn('applied_at', types.bigint, (c) => c.notNull())
    .execute();

  const rows = await tracker.selectFrom('schema_migrations').select('name').execute();
  const applied = new Set(rows.map((r) => r.name));

  const record = (name: string) =>
    tracker.insertInto('schema_migrations').values({ name, applied_at: Date.now() }).execute();

  // Reconcile a DB created under the old `user_version` scheme: nothing tracked
  // yet but a non-zero legacy version means those leading migrations already ran.
  if (applied.size === 0 && opts.legacyVersion && opts.legacyVersion > 0) {
    for (const m of migrations.slice(0, opts.legacyVersion)) {
      await record(m.name);
      applied.add(m.name);
    }
  }

  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    await m.up(db, { driver });
    await record(m.name);
  }
}

/** Count of applied migrations — surfaced as the store's schemaVersion. */
export async function countApplied<DB extends WithMigrations>(db: Kysely<DB>): Promise<number> {
  const tracker = db as unknown as Kysely<WithMigrations>;
  const row = await tracker
    .selectFrom('schema_migrations')
    .select((eb) => eb.fn.countAll().as('n'))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
