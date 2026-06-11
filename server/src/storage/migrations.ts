import type { Kysely } from 'kysely';

import { columnTypes } from './columns.js';
import type { DbDriver } from './config.js';

export interface SchemaMigrationsTable {
  name: string;
  applied_at: number;
}

export interface WithMigrations {
  schema_migrations: SchemaMigrationsTable;
}

export interface MigrationContext {
  driver: DbDriver;
}

export interface Migration<DB extends WithMigrations> {
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

export async function countApplied<DB extends WithMigrations>(db: Kysely<DB>): Promise<number> {
  const tracker = db as unknown as Kysely<WithMigrations>;
  const row = await tracker
    .selectFrom('schema_migrations')
    .select((eb) => eb.fn.countAll().as('n'))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
