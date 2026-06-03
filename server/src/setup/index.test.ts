import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { loadServerApp } from '../test/serverApp.js';
import { redactDbConfig } from './index.js';

describe('redactDbConfig', () => {
  it('never includes the password and reports presence only', () => {
    const out = redactDbConfig({
      driver: 'postgres',
      sqlite: { statePath: 's', siemPath: 'm' },
      postgres: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'secret', ssl: false },
    });
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(out.postgres).toMatchObject({ host: 'h', user: 'u', hasPassword: true });
  });
});

describe('database setup API', () => {
  it('serves the capability registry', async () => {
    const ctx = await loadServerApp();
    try {
      const res = await request(ctx.app).get('/api/setup/capabilities').expect(200);
      const ids = res.body.capabilities.map((c: { id: string }) => c.id);
      expect(ids).toContain('datacenter');
      expect(ids).toContain('logs');
    } finally {
      await ctx.cleanup();
    }
  });

  it('reports the current backend (sqlite by default)', async () => {
    const ctx = await loadServerApp();
    try {
      const res = await request(ctx.app).get('/api/setup/db').expect(200);
      expect(res.body.driver).toBe('sqlite');
      expect(res.body.sqlite).toBeTruthy();
    } finally {
      await ctx.cleanup();
    }
  });

  it('tests a sqlite connection without persisting', async () => {
    const ctx = await loadServerApp();
    try {
      await request(ctx.app)
        .post('/api/setup/db/test')
        .send({ driver: 'sqlite' })
        .expect(200, { ok: true });
      // Nothing persisted: still reports the default.
      expect((await request(ctx.app).get('/api/setup/db')).body.driver).toBe('sqlite');
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects an invalid body with 400', async () => {
    const ctx = await loadServerApp();
    try {
      const res = await request(ctx.app).post('/api/setup/db/test').send({ driver: 'oracle' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  it('reports a failed connection as ok:false (not an error status)', async () => {
    const ctx = await loadServerApp();
    try {
      const res = await request(ctx.app)
        .post('/api/setup/db/test')
        .send({
          driver: 'postgres',
          postgres: { host: '127.0.0.1', port: 59999, database: 'x', user: 'y', password: 'z' },
        })
        .expect(200);
      expect(res.body.ok).toBe(false);
      expect(typeof res.body.error).toBe('string');
    } finally {
      await ctx.cleanup();
    }
  });

  it('saves a sqlite selection to the bootstrap config', async () => {
    const ctx = await loadServerApp();
    try {
      await request(ctx.app)
        .post('/api/setup/db')
        .send({ driver: 'sqlite' })
        .expect(200, { ok: true, restartRequired: true });

      const written = JSON.parse(await readFile(process.env.DB_CONFIG_PATH as string, 'utf8'));
      expect(written.driver).toBe('sqlite');
    } finally {
      await ctx.cleanup();
    }
  });

  it('does not persist a backend whose connection fails', async () => {
    const ctx = await loadServerApp();
    try {
      const res = await request(ctx.app)
        .post('/api/setup/db')
        .send({
          driver: 'postgres',
          postgres: { host: '127.0.0.1', port: 59999, database: 'x', user: 'y', password: 'z' },
        });
      expect(res.status).toBe(502);
      await expect(readFile(process.env.DB_CONFIG_PATH as string, 'utf8')).rejects.toBeTruthy();
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects cross-origin writes', async () => {
    const ctx = await loadServerApp();
    try {
      await request(ctx.app)
        .post('/api/setup/db/test')
        .set('Host', 'dashboard.test')
        .set('Origin', 'http://evil.test')
        .send({ driver: 'sqlite' })
        .expect(403);
    } finally {
      await ctx.cleanup();
    }
  });

  it.skipIf(!process.env.PG_TEST_URL)('tests a live Postgres connection', async () => {
    const url = new URL(process.env.PG_TEST_URL as string);
    const ctx = await loadServerApp();
    try {
      await request(ctx.app)
        .post('/api/setup/db/test')
        .send({
          driver: 'postgres',
          postgres: {
            host: url.hostname,
            port: Number(url.port),
            database: url.pathname.slice(1),
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
          },
        })
        .expect(200, { ok: true });
    } finally {
      await ctx.cleanup();
    }
  });
});
