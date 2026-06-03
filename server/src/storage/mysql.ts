// MySQL / MariaDB handle for Kysely's MysqlDialect (mysql2 pool).
import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';

import type { SqlServerSettings } from './config.js';

export function openMysqlKysely<DB>(cfg: SqlServerSettings): Kysely<DB> {
  // mysql2 returns BIGINT as a JS number when it fits in the safe-integer range
  // (our timestamps/ids do), matching the SQLite/Postgres adapters.
  const pool = createPool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionLimit: 5,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
  });
  return new Kysely<DB>({ dialect: new MysqlDialect({ pool }) });
}
