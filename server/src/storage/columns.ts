import type { ColumnDefinitionBuilder } from 'kysely';

import type { DbDriver } from './config.js';

export function columnTypes(driver: DbDriver) {
  return {
    bigint: driver === 'sqlite' ? ('integer' as const) : ('bigint' as const),
    int: 'integer' as const,
    text: 'text' as const,

    shortText: driver === 'mysql' ? ('varchar(255)' as const) : ('text' as const),
    id: driver === 'postgres' ? ('serial' as const) : ('integer' as const),
  };
}

export function autoIdColumn(driver: DbDriver) {
  return (col: ColumnDefinitionBuilder) =>
    driver === 'postgres' ? col.primaryKey() : col.primaryKey().autoIncrement();
}
