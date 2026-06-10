// Store factory: opens both stores for the resolved backend, behind the same
// StateStore / SiemStore contracts. Each dialect builds a Kysely instance, runs
// the shared migrations, then wraps it with the shared store builders.
import { sql, type Kysely } from 'kysely';

import { createAuthStore } from '../auth/store.js';
import { createSiemStore, openSiemDb, SIEM_MIGRATIONS, type SiemDatabase } from '../siem/db.js';
import { createStateStore, STATE_MIGRATIONS, type StateDatabase } from '../state/db.js';
import type { ResolvedDbConfig } from './config.js';
import { runMigrations } from './migrations.js';
import { openMysqlKysely } from './mysql.js';
import { openPostgresKysely } from './postgres.js';
import { openSqliteKysely } from './sqlite.js';
import type { Stores } from './types.js';

export async function openStores(config: ResolvedDbConfig): Promise<Stores> {
  if (config.driver === 'sqlite') {
    // Open + migrate here (not via openStateDb) so the auth store can share the
    // same Kysely instance; state.close() tears it down for both.
    const { db: stateDb, legacyVersion } = await openSqliteKysely<StateDatabase>(
      config.sqlite.statePath,
    );
    await runMigrations(stateDb, STATE_MIGRATIONS, { driver: 'sqlite', legacyVersion });
    const state = createStateStore(stateDb, 'sqlite', config.sqlite.statePath);
    const auth = createAuthStore(stateDb, 'sqlite');
    const siem = await openSiemDb(config.sqlite.siemPath);
    return { state, siem, auth };
  }

  if (config.driver === 'postgres') {
    if (!config.postgres) throw new Error('postgres connection settings missing');
    // Two pools against the same database; state migrates first so it owns the
    // shared schema_migrations table, then siem adds its own rows.
    const stateDb = openPostgresKysely<StateDatabase>(config.postgres);
    await runMigrations(stateDb, STATE_MIGRATIONS, { driver: 'postgres' });
    const state = createStateStore(stateDb, 'postgres', null);
    const auth = createAuthStore(stateDb, 'postgres');

    const siemDb = openPostgresKysely<SiemDatabase>(config.postgres);
    await runMigrations(siemDb, SIEM_MIGRATIONS, { driver: 'postgres' });
    const siem = createSiemStore(siemDb, 'postgres');
    return { state, siem, auth };
  }

  if (config.driver === 'mysql') {
    if (!config.mysql) throw new Error('mysql connection settings missing');
    // Two pools against the same database; state migrates first so it owns the
    // shared schema_migrations table, then siem adds its own rows.
    const stateDb = openMysqlKysely<StateDatabase>(config.mysql);
    await runMigrations(stateDb, STATE_MIGRATIONS, { driver: 'mysql' });
    const state = createStateStore(stateDb, 'mysql', null);
    const auth = createAuthStore(stateDb, 'mysql');

    const siemDb = openMysqlKysely<SiemDatabase>(config.mysql);
    await runMigrations(siemDb, SIEM_MIGRATIONS, { driver: 'mysql' });
    const siem = createSiemStore(siemDb, 'mysql');
    return { state, siem, auth };
  }

  throw new Error(`database driver "${config.driver}" is not implemented`);
}

/**
 * Open a transient connection for the resolved backend, run a trivial query, and
 * close it — used by the onboarding connection test, never persisting anything.
 * Throws with a clear message on failure. SQLite is a local file (always available).
 */
export async function testDbConnection(config: ResolvedDbConfig): Promise<void> {
  if (config.driver === 'sqlite') return;

  let db: Kysely<Record<string, never>>;
  if (config.driver === 'postgres') {
    if (!config.postgres) throw new Error('postgres connection settings missing');
    db = openPostgresKysely<Record<string, never>>(config.postgres);
  } else if (config.driver === 'mysql') {
    if (!config.mysql) throw new Error('mysql connection settings missing');
    db = openMysqlKysely<Record<string, never>>(config.mysql);
  } else {
    throw new Error(`database driver "${config.driver}" is not implemented`);
  }

  try {
    await sql`select 1`.execute(db);
  } finally {
    await db.destroy();
  }
}
