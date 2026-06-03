// Dialect-aware column types. The same logical schema needs different physical
// types per backend: epoch-ms timestamps overflow Postgres int4 (need bigint);
// MySQL can't make a TEXT column a PRIMARY KEY or index it (needs VARCHAR);
// Postgres auto-increment ids use `serial`. SQLite's dynamic typing accepts the
// generic text/integer forms.
import type { ColumnDefinitionBuilder } from 'kysely';

import type { DbDriver } from './config.js';

export function columnTypes(driver: DbDriver) {
  return {
    bigint: driver === 'sqlite' ? ('integer' as const) : ('bigint' as const),
    int: 'integer' as const,
    text: 'text' as const,
    // Short lookup / PK columns — VARCHAR on MySQL so they can be keyed/indexed.
    shortText: driver === 'mysql' ? ('varchar(255)' as const) : ('text' as const),
    id: driver === 'postgres' ? ('serial' as const) : ('integer' as const),
  };
}

/** Auto-incrementing PK id: Postgres `serial` PK; SQLite/MySQL integer PK + auto-increment. */
export function autoIdColumn(driver: DbDriver) {
  return (col: ColumnDefinitionBuilder) =>
    driver === 'postgres' ? col.primaryKey() : col.primaryKey().autoIncrement();
}
