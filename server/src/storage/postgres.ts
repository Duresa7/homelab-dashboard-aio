import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { SqlServerSettings } from './config.js';

pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export function openPostgresKysely<DB>(cfg: SqlServerSettings): Kysely<DB> {
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
