import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SQLITE_SIEM_PATH,
  DEFAULT_SQLITE_STATE_PATH,
  resolveDbConfig,
  writeDbConfig,
  type DbConfigFile,
} from './config.js';

let dir: string;
const configPath = () => path.join(dir, 'database.json');
const writeFile = (cfg: unknown) => writeFileSync(configPath(), JSON.stringify(cfg), 'utf8');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dbcfg-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveDbConfig precedence', () => {
  it('defaults to SQLite at the current paths when nothing is set', () => {
    const cfg = resolveDbConfig({ env: {}, configPath: configPath() });
    expect(cfg.driver).toBe('sqlite');
    expect(cfg.sqlite.statePath).toBe(DEFAULT_SQLITE_STATE_PATH);
    expect(cfg.sqlite.siemPath).toBe(DEFAULT_SQLITE_SIEM_PATH);
    expect(cfg.postgres).toBeUndefined();
  });

  it('uses the file driver when no env override is present', () => {
    writeFile({ driver: 'postgres', postgres: { host: 'db.lan', database: 'logs' } });
    const cfg = resolveDbConfig({ env: {}, configPath: configPath() });
    expect(cfg.driver).toBe('postgres');
    expect(cfg.postgres).toMatchObject({ host: 'db.lan', database: 'logs', port: 5432 });
  });

  it('lets env DB_DRIVER override the file driver', () => {
    writeFile({ driver: 'postgres' });
    const cfg = resolveDbConfig({ env: { DB_DRIVER: 'mysql' }, configPath: configPath() });
    expect(cfg.driver).toBe('mysql');
    expect(cfg.mysql?.port).toBe(3306);
  });

  it('falls back to SQLite safely when the config file is malformed', () => {
    writeFileSync(configPath(), '{ this is not json', 'utf8');
    const cfg = resolveDbConfig({ env: {}, configPath: configPath() });
    expect(cfg.driver).toBe('sqlite');
  });

  it('ignores a file with an unknown driver', () => {
    writeFile({ driver: 'oracle' });
    const cfg = resolveDbConfig({ env: {}, configPath: configPath() });
    expect(cfg.driver).toBe('sqlite');
  });

  it('honors STATE_DB_PATH / SIEM_DB_PATH env for SQLite paths', () => {
    const state = path.join(dir, 'state.sqlite');
    const siem = path.join(dir, 'siem.sqlite');
    const cfg = resolveDbConfig({
      env: { STATE_DB_PATH: state, SIEM_DB_PATH: siem },
      configPath: configPath(),
    });
    expect(cfg.sqlite.statePath).toBe(path.resolve(state));
    expect(cfg.sqlite.siemPath).toBe(path.resolve(siem));
  });

  it('parses DATABASE_URL for a server backend', () => {
    const cfg = resolveDbConfig({
      env: {
        DB_DRIVER: 'postgres',
        DATABASE_URL: 'postgres://bob:s3cret@198.51.100.5:6543/metrics?ssl=true',
      },
      configPath: configPath(),
    });
    expect(cfg.postgres).toEqual({
      host: '198.51.100.5',
      port: 6543,
      database: 'metrics',
      user: 'bob',
      password: 's3cret',
      ssl: true,
    });
  });

  it('merges discrete DB_* env over file values', () => {
    writeFile({ driver: 'mysql', mysql: { host: 'old', database: 'old', port: 1111 } });
    const cfg = resolveDbConfig({
      env: { DB_HOST: 'new', DB_PASSWORD: 'pw' },
      configPath: configPath(),
    });
    expect(cfg.mysql).toMatchObject({ host: 'new', database: 'old', port: 1111, password: 'pw' });
  });
});

describe('writeDbConfig', () => {
  it('writes atomically and round-trips through resolveDbConfig', async () => {
    const cfg: DbConfigFile = {
      driver: 'postgres',
      postgres: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p', ssl: false },
    };
    await writeDbConfig(cfg, configPath());

    expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toEqual(cfg);
    const resolved = resolveDbConfig({ env: {}, configPath: configPath() });
    expect(resolved.driver).toBe('postgres');
    expect(resolved.postgres).toMatchObject({ host: 'h', database: 'd' });
  });

  it('leaves no temp file behind', async () => {
    await writeDbConfig({ driver: 'sqlite' }, configPath());
    const leftovers = readFileSync(configPath(), 'utf8');
    expect(leftovers).toContain('"driver": "sqlite"');
    expect(() => readFileSync(`${configPath()}.tmp-${process.pid}`, 'utf8')).toThrow();
  });
});
