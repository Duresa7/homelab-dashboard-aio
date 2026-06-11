import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface SqliteHandle<DB> {
  db: Kysely<DB>;
  legacyVersion: number;
}

export async function openSqliteKysely<DB>(dbPath: string): Promise<SqliteHandle<DB>> {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  const legacyVersion = sqlite.pragma('user_version', { simple: true }) as number;
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, legacyVersion };
}
