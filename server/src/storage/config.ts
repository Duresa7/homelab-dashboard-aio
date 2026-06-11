import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type DbDriver = 'sqlite' | 'postgres' | 'mysql';

export interface SqliteSettings {
  statePath: string;
  siemPath: string;
}

export interface SqlServerSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface DbConfigFile {
  driver: DbDriver;
  sqlite?: Partial<SqliteSettings>;
  postgres?: Partial<SqlServerSettings>;
  mysql?: Partial<SqlServerSettings>;
}

export interface ResolvedDbConfig {
  driver: DbDriver;
  sqlite: SqliteSettings;
  postgres?: SqlServerSettings;
  mysql?: SqlServerSettings;
}

export interface ResolveDbConfigOpts {
  env?: NodeJS.ProcessEnv;
  configPath?: string;

  file?: DbConfigFile | null;
}

const DATA_DIR = 'data';
export const DATA_DIR_PATH = path.resolve(DATA_DIR);
export const DEFAULT_CONFIG_PATH = path.resolve(DATA_DIR, 'database.json');

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.DB_CONFIG_PATH ? path.resolve(env.DB_CONFIG_PATH) : DEFAULT_CONFIG_PATH;
}
export const DEFAULT_SQLITE_STATE_PATH = path.resolve(DATA_DIR, 'dashboard.sqlite');
export const DEFAULT_SQLITE_SIEM_PATH = path.resolve(DATA_DIR, 'siem.sqlite');
const DEFAULT_PG_PORT = 5432;
const DEFAULT_MYSQL_PORT = 3306;
const SQLITE_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.db']);

function normalizeDriver(value: unknown): DbDriver | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value.trim().toLowerCase()) {
    case 'sqlite':
    case 'sqlite3':
      return 'sqlite';
    case 'postgres':
    case 'postgresql':
    case 'pg':
      return 'postgres';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    default:
      return undefined;
  }
}

function parseBool(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'require'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', 'disable'].includes(v)) return false;
  return undefined;
}

function isWithinPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizeSqliteDataPath(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error('SQLite path is required');
  const resolved = path.resolve(raw);
  if (!isWithinPath(DATA_DIR_PATH, resolved)) {
    throw new Error('SQLite path must stay under data/');
  }
  if (!SQLITE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error('SQLite path must end in .sqlite, .sqlite3, or .db');
  }
  return path.relative(process.cwd(), resolved);
}

function readConfigFile(configPath: string): DbConfigFile | null {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const driver = normalizeDriver((parsed as { driver?: unknown }).driver);
    if (!driver) return null;
    return { ...(parsed as DbConfigFile), driver };
  } catch {
    return null;
  }
}

function resolveSqlite(
  env: NodeJS.ProcessEnv,
  fileSqlite: Partial<SqliteSettings> | undefined,
): SqliteSettings {
  const fileStatePath = fileSqlite?.statePath
    ? safeFileSqlitePath(fileSqlite.statePath, DEFAULT_SQLITE_STATE_PATH)
    : DEFAULT_SQLITE_STATE_PATH;
  const fileSiemPath = fileSqlite?.siemPath
    ? safeFileSqlitePath(fileSqlite.siemPath, DEFAULT_SQLITE_SIEM_PATH)
    : DEFAULT_SQLITE_SIEM_PATH;
  const statePath = env.STATE_DB_PATH || fileStatePath;
  const siemPath = env.SIEM_DB_PATH || fileSiemPath;
  return { statePath: path.resolve(statePath), siemPath: path.resolve(siemPath) };
}

function safeFileSqlitePath(value: string, fallback: string): string {
  try {
    return normalizeSqliteDataPath(value);
  } catch {
    return fallback;
  }
}

function fromDatabaseUrl(url: string, defaultPort: number): SqlServerSettings | null {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || '127.0.0.1',
      port: u.port ? Number(u.port) : defaultPort,
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'homelab',
      user: decodeURIComponent(u.username) || 'homelab',
      password: decodeURIComponent(u.password),
      ssl: parseBool(u.searchParams.get('sslmode') ?? u.searchParams.get('ssl')) ?? false,
    };
  } catch {
    return null;
  }
}

function resolveServer(
  env: NodeJS.ProcessEnv,
  fileServer: Partial<SqlServerSettings> | undefined,
  defaultPort: number,
): SqlServerSettings {
  const fromUrl = env.DATABASE_URL ? fromDatabaseUrl(env.DATABASE_URL, defaultPort) : null;
  if (fromUrl) return fromUrl;

  const port = env.DB_PORT ? Number(env.DB_PORT) : (fileServer?.port ?? defaultPort);
  return {
    host: env.DB_HOST || fileServer?.host || '127.0.0.1',
    port: Number.isFinite(port) && port > 0 ? port : defaultPort,
    database: env.DB_NAME || fileServer?.database || 'homelab',
    user: env.DB_USER || fileServer?.user || 'homelab',
    password: env.DB_PASSWORD ?? fileServer?.password ?? '',
    ssl: parseBool(env.DB_SSL) ?? fileServer?.ssl ?? false,
  };
}

export function resolveDbConfig(opts: ResolveDbConfigOpts = {}): ResolvedDbConfig {
  const env = opts.env ?? process.env;
  const configPath = opts.configPath ?? configFilePath(env);
  const file = opts.file !== undefined ? opts.file : readConfigFile(configPath);

  const driver = normalizeDriver(env.DB_DRIVER) ?? file?.driver ?? 'sqlite';
  const sqlite = resolveSqlite(env, file?.sqlite);

  if (driver === 'postgres') {
    return { driver, sqlite, postgres: resolveServer(env, file?.postgres, DEFAULT_PG_PORT) };
  }
  if (driver === 'mysql') {
    return { driver, sqlite, mysql: resolveServer(env, file?.mysql, DEFAULT_MYSQL_PORT) };
  }
  return { driver: 'sqlite', sqlite };
}

export async function writeDbConfig(
  config: DbConfigFile,
  configPath = DEFAULT_CONFIG_PATH,
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(tmp, configPath);
}
