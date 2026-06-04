// One contract suite run against every backend. SQLite always runs; Postgres
// runs when PG_TEST_URL is set (a throwaway container in dev/CI), MySQL when
// MYSQL_TEST_URL is set. Same assertions on all three prove one query codebase.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConnection } from 'mysql2/promise';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InsertEventInput } from '../siem/types.js';
import { resolveDbConfig, type ResolvedDbConfig } from './config.js';
import { openStores } from './factory.js';
import type { Stores } from './types.js';

const NO_CONFIG_FILE = path.join(os.tmpdir(), 'homelab-no-db-config.json');

interface Backend {
  name: string;
  skip: boolean;
  prepare: () => Promise<{ config: ResolvedDbConfig; cleanup: () => Promise<void> }>;
}

const sqliteBackend: Backend = {
  name: 'sqlite',
  skip: false,
  async prepare() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'homelab-backends-sqlite-'));
    const config: ResolvedDbConfig = {
      driver: 'sqlite',
      sqlite: {
        statePath: path.join(dir, 'state.sqlite'),
        siemPath: path.join(dir, 'siem.sqlite'),
      },
    };
    return { config, cleanup: () => rm(dir, { recursive: true, force: true }) };
  },
};

const postgresBackend: Backend = {
  name: 'postgres',
  skip: !process.env.PG_TEST_URL,
  async prepare() {
    const config = resolveDbConfig({
      env: { DB_DRIVER: 'postgres', DATABASE_URL: process.env.PG_TEST_URL },
      configPath: NO_CONFIG_FILE,
    });
    const c = config.postgres!;
    const client = new pg.Client({
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
    });
    await client.connect();
    await client.query('DROP TABLE IF EXISTS schema_migrations, app_state, syslog_events CASCADE');
    await client.end();
    return { config, cleanup: async () => {} };
  },
};

const mysqlBackend: Backend = {
  name: 'mysql',
  skip: !process.env.MYSQL_TEST_URL,
  async prepare() {
    const config = resolveDbConfig({
      env: { DB_DRIVER: 'mysql', DATABASE_URL: process.env.MYSQL_TEST_URL },
      configPath: NO_CONFIG_FILE,
    });
    const c = config.mysql!;
    const conn = await createConnection({
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.user,
      password: c.password,
    });
    await conn.query('DROP TABLE IF EXISTS schema_migrations, app_state, syslog_events');
    await conn.end();
    return { config, cleanup: async () => {} };
  },
};

const BACKENDS = [sqliteBackend, postgresBackend, mysqlBackend];

function evt(over: Partial<InsertEventInput> = {}): InsertEventInput {
  return {
    receivedAt: 1000,
    sourceIp: '198.51.100.1',
    severity: 6,
    message: 'hello',
    raw: 'raw hello',
    format: 'rfc3164',
    deviceKind: 'gateway',
    category: 'system',
    ...over,
  };
}

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`stores contract: ${backend.name}`, () => {
    let stores: Stores;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const prepared = await backend.prepare();
      cleanup = prepared.cleanup;
      stores = await openStores(prepared.config);
    });
    afterEach(async () => {
      await stores.state.close();
      await stores.siem.close();
      await cleanup();
    });

    it('state: put / get / getAll / delete / importBulk / stats', async () => {
      const { state } = stores;
      expect((await state.getAll()).values).toEqual({});

      const ts = await state.put('tempUnit', 'f');
      expect(typeof ts).toBe('number');
      expect(await state.get('tempUnit')).toEqual({ value: 'f', updatedAt: ts });

      await state.put('route', { section: 'overview' });
      expect((await state.getAll()).values).toEqual({
        tempUnit: 'f',
        route: { section: 'overview' },
      });

      expect(await state.delete('tempUnit')).toBe(1);
      expect(await state.get('tempUnit')).toBeNull();

      // importBulk upserts (overwrites the existing `route`).
      const n = await state.importBulk({ a: 1, b: [2, 3], route: { section: 'docker' } });
      expect(n).toBe(3);
      expect((await state.get('route'))?.value).toEqual({ section: 'docker' });

      const stats = await state.stats();
      expect(stats.keys).toBe(3);
      expect(stats.schemaVersion).toBeGreaterThanOrEqual(2);
    });

    it('siem: insert / query / search / stats / totals / purge / replay', async () => {
      const { siem } = stores;
      const e1 = await siem.insertEvent(
        evt({
          receivedAt: 100,
          severity: 3,
          category: 'firewall',
          sourceIp: '1.1.1.1',
          message: 'blocked 50% of traffic',
          extra: { rule: 'x' },
        }),
      );
      expect(e1.id).toBeGreaterThan(0);
      const got = await siem.getById(e1.id);
      expect(got).toMatchObject({ sourceIp: '1.1.1.1', extra: { rule: 'x' } });

      const e2 = await siem.insertEvent(
        evt({
          receivedAt: 200,
          severity: 6,
          category: 'system',
          sourceIp: '2.2.2.2',
          message: 'ALL OK',
        }),
      );
      expect(e2.id).toBeGreaterThan(e1.id);

      expect((await siem.queryEvents({ severity: '3' })).map((e) => e.sourceIp)).toEqual([
        '1.1.1.1',
      ]);
      expect((await siem.queryEvents({ category: 'firewall' })).length).toBe(1);
      // Case-insensitive on every backend (Postgres via ILIKE).
      expect((await siem.queryEvents({ q: 'all ok' })).length).toBe(1);
      // Literal % is escaped, not a wildcard.
      expect((await siem.queryEvents({ q: '50%' })).length).toBe(1);
      expect((await siem.queryEvents({ q: 'no-such-text' })).length).toBe(0);
      expect((await siem.queryEvents({ order: 'asc' })).map((e) => e.receivedAt)).toEqual([
        100, 200,
      ]);

      const stats = await siem.getStats({ since: 0 });
      expect(stats.bySeverity['3']).toBe(1);
      expect(stats.byCategory.firewall).toBe(1);
      expect(stats.bySource.find((s) => s.ip === '1.1.1.1')?.count).toBe(1);

      const totals = await siem.totals();
      expect(totals.total).toBe(2);
      expect(totals.lastEventAt).toBe(200);

      expect(await siem.purgeOlderThanChunk(150, 10)).toBe(1);
      expect((await siem.totals()).total).toBe(1);

      expect((await siem.replayAfter(0)).map((e) => e.receivedAt)).toEqual([200]);
    });
  });
}
