import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { bootstrapAdmin } from '../test/auth.js';
import { loadServerApp, withJsonUpstream } from '../test/serverApp.js';
import { keepDbSecrets, redactDbConfig } from './index.js';
import type { ResolvedDbConfig } from '../storage/config.js';

const SECRET_VALUE = 'tok-XYZ-9876';
const proxmox = {
  capability: 'datacenter',
  vendor: 'proxmox',
  config: {
    baseUrl: 'https://pve.example.test',
    tokenId: 'id',
    tokenSecret: SECRET_VALUE,
    node: 'pve1',
  },
};

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

describe('keepDbSecrets', () => {
  const current: ResolvedDbConfig = {
    driver: 'postgres',
    sqlite: { statePath: 's', siemPath: 'm' },
    postgres: { host: 'h', port: 5432, database: 'd', user: 'u', password: 'kept-pw', ssl: false },
  };

  it('keeps the stored password when a same-backend re-save omits it', () => {
    const out = keepDbSecrets(
      { driver: 'postgres', postgres: { host: 'h', database: 'd', user: 'u' } },
      current,
    );
    expect(out.postgres?.password).toBe('kept-pw');
  });

  it('lets an explicitly supplied password win', () => {
    const out = keepDbSecrets(
      { driver: 'postgres', postgres: { host: 'h', database: 'd', user: 'u', password: 'new-pw' } },
      current,
    );
    expect(out.postgres?.password).toBe('new-pw');
  });

  it('does not inherit a password when switching to a different backend', () => {
    const out = keepDbSecrets(
      { driver: 'mysql', mysql: { host: 'h', database: 'd', user: 'u' } },
      current,
    );
    expect(out.mysql?.password).toBeUndefined();
  });

  it('is a no-op for sqlite (no secret)', () => {
    const file = { driver: 'sqlite' as const, sqlite: { statePath: 'data/x.sqlite' } };
    expect(keepDbSecrets(file, current)).toBe(file);
  });
});

describe('database setup API', () => {
  it('serves the capability registry', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api.get('/api/setup/capabilities').expect(200);
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
      const api = await bootstrapAdmin(ctx.app);
      const res = await api.get('/api/setup/db').expect(200);
      expect(res.body.driver).toBe('sqlite');
      expect(res.body.sqlite).toBeTruthy();
    } finally {
      await ctx.cleanup();
    }
  });

  it('tests a sqlite connection without persisting', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api.post('/api/setup/db/test').send({ driver: 'sqlite' }).expect(200, { ok: true });

      expect((await api.get('/api/setup/db')).body.driver).toBe('sqlite');
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects an invalid body with 400', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api.post('/api/setup/db/test').send({ driver: 'oracle' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  it('reports a failed connection as ok:false (not an error status)', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api
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
      const api = await bootstrapAdmin(ctx.app);
      await api
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
      const api = await bootstrapAdmin(ctx.app);
      const res = await api.post('/api/setup/db').send({
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
      const api = await bootstrapAdmin(ctx.app);
      await api
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
      const api = await bootstrapAdmin(ctx.app);
      await api
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

describe('integration config API', () => {
  it('reports onboarding incomplete on a clean instance', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api.get('/api/setup/status').expect(200);
      expect(res.body).toEqual({ onboardingComplete: false, configuredCapabilities: [] });
    } finally {
      await ctx.cleanup();
    }
  });

  it('marks onboarding complete and can reopen it', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api.post('/api/setup/complete').send({}).expect(200, { ok: true });
      await api
        .get('/api/setup/status')
        .expect(200)
        .expect((res) => {
          expect(res.body.onboardingComplete).toBe(true);
        });

      await api.post('/api/setup/complete').send({ complete: false }).expect(200, { ok: true });
      await api
        .get('/api/setup/status')
        .expect(200)
        .expect((res) => {
          expect(res.body.onboardingComplete).toBe(false);
        });
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects cross-origin complete writes', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api
        .post('/api/setup/complete')
        .set('Host', 'dashboard.test')
        .set('Origin', 'http://evil.test')
        .send({})
        .expect(403);
    } finally {
      await ctx.cleanup();
    }
  });

  it('upserts a selection and never echoes the secret back', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api.put('/api/setup/config').send(proxmox).expect(200, { ok: true });

      const cfg = await api.get('/api/setup/config').expect(200);
      const dc = cfg.body.capabilities.datacenter;
      expect(dc.config).toMatchObject({ baseUrl: 'https://pve.example.test', node: 'pve1' });
      expect(dc.config).not.toHaveProperty('tokenSecret');
      expect(dc.secrets).toEqual({ tokenSecret: true });
      expect(JSON.stringify(cfg.body)).not.toContain(SECRET_VALUE);

      const status = await api.get('/api/setup/status').expect(200);
      expect(status.body.configuredCapabilities).toContain('datacenter');
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects an invalid selection with 400', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api
        .put('/api/setup/config')
        .send({ capability: 'datacenter', vendor: 'proxmox', config: { baseUrl: 'x' } })
        .expect(400);
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects cross-origin writes', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api
        .put('/api/setup/config')
        .set('Host', 'dashboard.test')
        .set('Origin', 'http://evil.test')
        .send(proxmox)
        .expect(403);
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects sqlite paths outside data from setup writes', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api
        .post('/api/setup/db/test')
        .send({
          driver: 'sqlite',
          sqlite: { statePath: path.join(os.tmpdir(), 'outside.sqlite') },
        })
        .expect(400);
      expect(res.body.error).toMatch(/under data/i);
    } finally {
      await ctx.cleanup();
    }
  });

  it('never exposes setup.* keys through the public state API', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api.put('/api/setup/config').send(proxmox).expect(200);

      const state = await api.get('/api/state').expect(200);
      expect(Object.keys(state.body.values)).not.toContain('setup.integrationConfig');
      await api.get('/api/state/setup.integrationConfig').expect(400);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('connection test API', () => {
  it('returns ok for a reachable HTTP backend', async () => {
    await withJsonUpstream(
      { '/api2/json/version': { data: { version: '8.0' } } },
      async (baseUrl) => {
        const ctx = await loadServerApp();
        try {
          const api = await bootstrapAdmin(ctx.app);
          await api
            .post('/api/setup/test')
            .send({
              capability: 'datacenter',
              config: { baseUrl, tokenId: 'id', tokenSecret: 's' },
            })
            .expect(200, { ok: true });
        } finally {
          await ctx.cleanup();
        }
      },
    );
  });

  it('reports a failed connection as ok:false', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      const res = await api
        .post('/api/setup/test')
        .send({
          capability: 'datacenter',
          config: { baseUrl: 'http://127.0.0.1:9', tokenId: 'i', tokenSecret: 's' },
        })
        .expect(200);
      expect(res.body.ok).toBe(false);
      expect(typeof res.body.error).toBe('string');
    } finally {
      await ctx.cleanup();
    }
  });

  it('does not replay stored secrets to a changed test URL', async () => {
    await withJsonUpstream(
      { '/api2/json/version': { data: { version: '8.0' } } },
      async (baseUrl) => {
        const ctx = await loadServerApp();
        try {
          const api = await bootstrapAdmin(ctx.app);
          await api
            .put('/api/setup/config')
            .send({
              ...proxmox,
              config: { ...proxmox.config, baseUrl: 'https://pve.example.test' },
            })
            .expect(200);

          const res = await api
            .post('/api/setup/test')
            .send({
              capability: 'datacenter',
              config: { baseUrl, tokenId: 'id' },
            })
            .expect(400);
          expect(res.body.error).toMatch(/secret fields are required/i);
        } finally {
          await ctx.cleanup();
        }
      },
    );
  });

  it('marks SSH/listener capabilities as untestable', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api
        .post('/api/setup/test')
        .send({ capability: 'gpu', config: { mode: 'local' } })
        .expect(200, { ok: true, untestable: true });
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects an unknown capability and cross-origin writes', async () => {
    const ctx = await loadServerApp();
    try {
      const api = await bootstrapAdmin(ctx.app);
      await api.post('/api/setup/test').send({ capability: 'nope' }).expect(400);
      await api
        .post('/api/setup/test')
        .set('Host', 'dashboard.test')
        .set('Origin', 'http://evil.test')
        .send({ capability: 'datacenter', config: {} })
        .expect(403);
    } finally {
      await ctx.cleanup();
    }
  });
});
