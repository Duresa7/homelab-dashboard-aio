// PostgreSQL handle for Kysely's PostgresDialect (node-postgres pool).
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { SqlServerSettings } from './config.js';

// node-postgres returns int8 (bigint) and COUNT() results as strings by default.
// Our epoch-ms timestamps and counts fit in JS's safe-integer range, so parse
// them to numbers for parity with the SQLite/MySQL drivers. OID 20 = int8.
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
