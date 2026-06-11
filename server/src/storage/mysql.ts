import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';

import type { SqlServerSettings } from './config.js';

export function openMysqlKysely<DB>(cfg: SqlServerSettings): Kysely<DB> {
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
