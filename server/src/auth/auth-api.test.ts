import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { authedAgent, bootstrapAdmin, TEST_PASSWORD } from '../test/auth.js';
import { loadServerApp } from '../test/serverApp.js';

async function usingApp(
  env: Record<string, string>,
  fn: (ctx: Awaited<ReturnType<typeof loadServerApp>>) => Promise<unknown>,
) {
  const ctx = await loadServerApp(env);
  try {
    return await fn(ctx);
  } finally {
    await ctx.cleanup();
  }
}

describe('bootstrap mode', () => {
  it('reports zero users and gates the API until an admin exists', async () => {
    await usingApp({}, async ({ app }) => {
      const status = await request(app).get('/api/auth/status').expect(200);
      expect(status.body).toMatchObject({ usersExist: false, authenticated: false });

      // Protected routes 401 with the bootstrap hint.
      const res = await request(app).get('/api/state').expect(401);
      expect(res.body.bootstrap).toBe(true);

      // Unauthenticated /api/health is minimized to the liveness flag.
      const health = await request(app).get('/api/health').expect(200);
      expect(health.body).toEqual({ ok: true });
    });
  });

  it('creates the first admin, logs it in, and closes bootstrap', async () => {
    await usingApp({}, async ({ app }) => {
      const agent = await bootstrapAdmin(app);

      const me = await agent.get('/api/auth/me').expect(200);
      expect(me.body.user).toMatchObject({ username: 'admin', role: 'admin' });

      // Second bootstrap is rejected.
      await request(app)
        .post('/api/auth/bootstrap')
        .send({ username: 'evil', password: TEST_PASSWORD })
        .expect(403);

      // Authenticated health is the full payload again.
      const health = await agent.get('/api/health').expect(200);
      expect(health.body).toHaveProperty('unifi');
    });
  });

  it('rejects weak and identifier-derived passwords server-side', async () => {
    await usingApp({}, async ({ app }) => {
      await request(app)
        .post('/api/auth/bootstrap')
        .send({ username: 'admin', password: 'short' })
        .expect(400);
      await request(app)
        .post('/api/auth/bootstrap')
        .send({ username: 'admin', password: 'password12345' })
        .expect(400);
      await request(app)
        .post('/api/auth/bootstrap')
        .send({ username: 'testuser', password: 'testuser2026' })
        .expect(400);
    });
  });
});

describe('login and sessions', () => {
  it('logs in, persists the session, and logs out', async () => {
    await usingApp({}, async ({ app }) => {
      await bootstrapAdmin(app);

      const agent = request.agent(app);
      await agent
        .post('/api/auth/login')
        .send({ username: 'ADMIN ', password: TEST_PASSWORD })
        .expect(200);
      await agent.get('/api/state').expect(200);

      const sessions = await agent.get('/api/auth/sessions').expect(200);
      expect(sessions.body.sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.body.sessions.some((s: { current: boolean }) => s.current)).toBe(true);

      await agent.post('/api/auth/logout').expect(200);
      await agent.get('/api/state').expect(401);
    });
  });

  it('rejects bad credentials without leaking which part failed', async () => {
    await usingApp({}, async ({ app }) => {
      await bootstrapAdmin(app);
      const wrongPw = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'totally wrong password' })
        .expect(401);
      const noUser = await request(app)
        .post('/api/auth/login')
        .send({ username: 'ghost', password: 'totally wrong password' })
        .expect(401);
      expect(wrongPw.body.error).toBe(noUser.body.error);
    });
  });

  it('throttles repeated failures with 429 + Retry-After', async () => {
    await usingApp({}, async ({ app }) => {
      await bootstrapAdmin(app);
      let throttled = false;
      for (let i = 0; i < 7; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ username: 'admin', password: 'wrong password attempt' });
        if (res.status === 429) {
          throttled = true;
          expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
          expect(res.body.retryAfterMs).toBeGreaterThan(0);
          break;
        }
        expect(res.status).toBe(401);
      }
      expect(throttled).toBe(true);
    });
  });

  it('changes the password and revokes other sessions', async () => {
    await usingApp({}, async ({ app }) => {
      const agent = await bootstrapAdmin(app);

      // A second session for the same user.
      const other = request.agent(app);
      await other
        .post('/api/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(200);

      const nextPassword = 'granite parka mezzanine 7 fox';
      await agent
        .post('/api/auth/change-password')
        .send({ current: 'wrong old password', next: nextPassword })
        .expect(403);
      await agent
        .post('/api/auth/change-password')
        .send({ current: TEST_PASSWORD, next: nextPassword })
        .expect(200);

      // The changing session survives; the other one is revoked.
      await agent.get('/api/auth/me').expect(200);
      await other.get('/api/auth/me').expect(401);

      const fresh = request.agent(app);
      await fresh
        .post('/api/auth/login')
        .send({ username: 'admin', password: nextPassword })
        .expect(200);
    });
  });
});

describe('totp', () => {
  it('enrolls, requires the code at login, and accepts a recovery code', async () => {
    await usingApp({}, async ({ app }) => {
      const agent = await bootstrapAdmin(app);

      const setup = await agent.post('/api/auth/totp/setup').expect(200);
      expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
      expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

      // Wrong code does not enable.
      await agent.post('/api/auth/totp/enable').send({ code: '000000' }).expect(400);

      const { generate } = await import('otplib');
      const code = await generate({ secret: setup.body.secret });
      const enabled = await agent.post('/api/auth/totp/enable').send({ code }).expect(200);
      const recoveryCodes: string[] = enabled.body.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);

      // Password alone now yields a pending TOTP step.
      const fresh = request.agent(app);
      const step1 = await fresh
        .post('/api/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(200);
      expect(step1.body.totpRequired).toBe(true);

      // Bad code rejected; recovery code accepted and burned.
      await fresh
        .post('/api/auth/login/totp')
        .send({ pendingToken: step1.body.pendingToken, code: '000000' })
        .expect(401);
      await fresh
        .post('/api/auth/login/totp')
        .send({ pendingToken: step1.body.pendingToken, code: recoveryCodes[0] })
        .expect(200);
      await fresh.get('/api/auth/me').expect(200);

      // Same recovery code cannot be used twice.
      const again = request.agent(app);
      const step2 = await again
        .post('/api/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(200);
      await again
        .post('/api/auth/login/totp')
        .send({ pendingToken: step2.body.pendingToken, code: recoveryCodes[0] })
        .expect(401);

      // A real TOTP code still works.
      const code2 = await generate({ secret: setup.body.secret });
      await again
        .post('/api/auth/login/totp')
        .send({ pendingToken: step2.body.pendingToken, code: code2 })
        .expect(200);
    });
  });

  it('disables totp with the account password', async () => {
    await usingApp({}, async ({ app }) => {
      const agent = await bootstrapAdmin(app);
      const setup = await agent.post('/api/auth/totp/setup').expect(200);
      const { generate } = await import('otplib');
      await agent
        .post('/api/auth/totp/enable')
        .send({ code: await generate({ secret: setup.body.secret }) })
        .expect(200);

      await agent.post('/api/auth/totp/disable').send({ password: 'wrong password' }).expect(403);
      await agent.post('/api/auth/totp/disable').send({ password: TEST_PASSWORD }).expect(200);

      const fresh = request.agent(app);
      const login = await fresh
        .post('/api/auth/login')
        .send({ username: 'admin', password: TEST_PASSWORD })
        .expect(200);
      expect(login.body.totpRequired).toBeUndefined();
    });
  });
});

describe('role matrix', () => {
  it('viewer reads but cannot write; member writes but cannot administer', async () => {
    await usingApp({}, async ({ app }) => {
      const admin = await bootstrapAdmin(app);
      const member = await authedAgent(app, 'member', { admin });
      const viewer = await authedAgent(app, 'viewer', { admin });

      // Reads: everyone.
      await viewer.get('/api/state').expect(200);
      await member.get('/api/state').expect(200);
      await viewer.get('/api/setup/status').expect(200);
      await viewer.get('/api/setup/capabilities').expect(200);

      // State writes: member+, not viewer.
      await viewer.put('/api/state/tweaks').send({ a: 1 }).expect(403);
      await member.put('/api/state/tweaks').send({ a: 1 }).expect(200);
      await admin.put('/api/state/tweaks').send({ a: 2 }).expect(200);

      // WoL: member+ — an empty body 400s, proving the member passed the gate
      // without actually broadcasting a packet from the test run.
      await viewer.post('/api/wol/wake').send({}).expect(403);
      await member.post('/api/wol/wake').send({}).expect(400);

      // Setup config + users: admin only.
      await viewer.get('/api/setup/config').expect(403);
      await member.get('/api/setup/config').expect(403);
      await admin.get('/api/setup/config').expect(200);
      await member.get('/api/users').expect(403);
      await admin.get('/api/users').expect(200);

      // Debug endpoints: admin role required, then still env-gated (404).
      await member.get('/api/state/debug').expect(403);
      await admin.get('/api/state/debug').expect(404);
    });
  });
});

describe('user management', () => {
  it('creates, edits, and deletes users with last-admin protection', async () => {
    await usingApp({}, async ({ app }) => {
      const admin = await bootstrapAdmin(app);

      const created = await admin
        .post('/api/users')
        .send({ username: 'kira', displayName: 'Kira', password: TEST_PASSWORD, role: 'member' })
        .expect(201);
      const kiraId = created.body.user.id;

      // Duplicate username rejected.
      await admin
        .post('/api/users')
        .send({ username: 'Kira', password: TEST_PASSWORD, role: 'viewer' })
        .expect(409);

      // Promote, then verify the last-admin guard protects the original admin.
      await admin.patch(`/api/users/${kiraId}`).send({ role: 'admin' }).expect(200);
      const adminId = (await admin.get('/api/auth/me').expect(200)).body.user.id;
      await admin.patch(`/api/users/${adminId}`).send({ role: 'viewer' }).expect(200);
      // Now kira is the only admin — she cannot be demoted or deleted.
      const kira = request.agent(app);
      await kira
        .post('/api/auth/login')
        .send({ username: 'kira', password: TEST_PASSWORD })
        .expect(200);
      await kira.patch(`/api/users/${kiraId}`).send({ role: 'member' }).expect(409);
      await kira.delete(`/api/users/${kiraId}`).expect(409);

      // The self-demoted original admin keeps their current session by design
      // but has lost admin powers.
      await admin.get('/api/users').expect(403);
    });
  });

  it('admin password reset revokes the user sessions', async () => {
    await usingApp({}, async ({ app }) => {
      const admin = await bootstrapAdmin(app);
      const member = await authedAgent(app, 'member', { admin });
      const memberId = (await member.get('/api/auth/me').expect(200)).body.user.id;

      await admin
        .post(`/api/users/${memberId}/password`)
        .send({ password: 'walnut bicycle ember 3 tide' })
        .expect(200);
      await member.get('/api/auth/me').expect(401);

      const fresh = request.agent(app);
      await fresh
        .post('/api/auth/login')
        .send({ username: 'test-member', password: 'walnut bicycle ember 3 tide' })
        .expect(200);
    });
  });
});

describe('proxy auth', () => {
  it('maps a trusted header to an existing local user and rejects unknowns', async () => {
    await usingApp(
      {
        AUTH_PROXY_ENABLED: 'true',
        AUTH_PROXY_HEADER: 'remote-user',
        // supertest requests arrive from loopback.
        AUTH_PROXY_TRUSTED_IPS: '127.0.0.1, ::1',
      },
      async ({ app }) => {
        await bootstrapAdmin(app);

        const viaProxy = await request(app)
          .get('/api/auth/me')
          .set('Remote-User', 'admin')
          .expect(200);
        expect(viaProxy.body).toMatchObject({ via: 'proxy' });
        expect(viaProxy.body.user.username).toBe('admin');

        // Unknown asserted user → still unauthenticated.
        await request(app).get('/api/auth/me').set('Remote-User', 'ghost').expect(401);
      },
    );
  });

  it('ignores the header entirely when disabled', async () => {
    await usingApp({}, async ({ app }) => {
      await bootstrapAdmin(app);
      await request(app).get('/api/auth/me').set('Remote-User', 'admin').expect(401);
    });
  });
});
