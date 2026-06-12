import { describe, expect, it, vi } from 'vitest';

import { hashPassword } from './passwords.js';
import { createLoginRateLimiter, type LoginRateLimiter } from './rate-limit.js';
import { createSessionLifecycleService } from './session-lifecycle.js';
import { generateRecoveryCodes } from './totp.js';
import type { AuthStore, NewSession, UserRecord } from './types.js';

const TEST_PASSWORD = 'granite parka mezzanine 7 fox';

async function userFixture(patch: Partial<UserRecord> = {}): Promise<UserRecord> {
  return {
    id: 1,
    username: 'admin',
    displayName: 'Admin',
    email: null,
    passwordHash: await hashPassword(TEST_PASSWORD),
    role: 'admin',
    totpSecret: null,
    totpEnabled: false,
    recoveryCodes: [],
    createdAt: 1,
    updatedAt: 1,
    passwordChangedAt: 1,
    ...patch,
  };
}

function storeFixture(user: UserRecord): { store: AuthStore; sessions: NewSession[] } {
  const sessions: NewSession[] = [];
  return {
    sessions,
    store: {
      countUsers: vi.fn(async () => 1),
      countAdmins: vi.fn(async () => 1),
      getUserById: vi.fn(async (id: number) => (id === user.id ? user : null)),
      getUserByUsername: vi.fn(async (username: string) =>
        username === user.username ? user : null,
      ),
      listUsers: vi.fn(async () => [user]),
      createUser: vi.fn(),
      updateUser: vi.fn(async (id, patch) => {
        if (id === user.id) Object.assign(user, patch);
      }),
      deleteUser: vi.fn(),
      createSession: vi.fn(async (session: NewSession) => {
        sessions.push(session);
      }),
      getSessionByTokenHash: vi.fn(),
      touchSession: vi.fn(),
      deleteSession: vi.fn(),
      deleteSessionsForUser: vi.fn(async () => 0),
      listSessionsForUser: vi.fn(async () => []),
      deleteExpiredSessions: vi.fn(async () => 0),
    },
  };
}

function serviceFixture({
  user,
  limiter = createLoginRateLimiter({ now: () => 1_000 }),
  now = () => 1_000,
}: {
  user: UserRecord;
  limiter?: LoginRateLimiter;
  now?: () => number;
}) {
  const { store, sessions } = storeFixture(user);
  const service = createSessionLifecycleService({
    store,
    limiter,
    usersExist: async () => true,
    noteUserCreated: vi.fn(),
    now,
  });
  return { service, store, sessions };
}

describe('auth session lifecycle service', () => {
  it('logs in with normalized credentials and creates a session', async () => {
    const user = await userFixture();
    const { service, store, sessions } = serviceFixture({ user });

    const result = await service.login(
      { username: ' ADMIN ', password: TEST_PASSWORD, remember: false },
      { ip: '127.0.0.1', userAgent: 'vitest' },
    );

    expect(result.kind).toBe('authenticated');
    if (result.kind !== 'authenticated') throw new Error('expected authenticated login');
    expect(store.getUserByUsername).toHaveBeenCalledWith('admin');
    expect(sessions).toHaveLength(1);
    expect(result.session.token).not.toBe(sessions[0].tokenHash);
    expect(sessions[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sessions[0]).toMatchObject({
      userId: 1,
      remember: false,
      ip: '127.0.0.1',
      userAgent: 'vitest',
      expiresAt: 1_000 + 30 * 24 * 60 * 60 * 1000,
    });
  });

  it('rejects rate-limited logins before loading or checking the password', async () => {
    const user = await userFixture();
    const limiter: LoginRateLimiter = {
      key: vi.fn(() => 'rate-key'),
      check: vi.fn(() => ({ allowed: false, retryAfterMs: 5_000 })),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    };
    const { service, store } = serviceFixture({ user, limiter });

    await expect(
      service.login({ username: 'admin', password: TEST_PASSWORD }, { ip: '127.0.0.1' }),
    ).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 5_000,
    });

    expect(store.getUserByUsername).not.toHaveBeenCalled();
    expect(store.createSession).not.toHaveBeenCalled();
    expect(limiter.recordFailure).not.toHaveBeenCalled();
  });

  it('expires pending TOTP login tokens', async () => {
    const user = await userFixture({
      totpEnabled: true,
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });
    let currentTime = 1_000;
    const { service, store } = serviceFixture({ user, now: () => currentTime });

    const first = await service.login(
      { username: 'admin', password: TEST_PASSWORD },
      { ip: '127.0.0.1' },
    );
    expect(first.kind).toBe('totpRequired');
    currentTime += 5 * 60 * 1000 + 1;

    if (first.kind !== 'totpRequired') throw new Error('expected pending TOTP login');
    await expect(
      service.loginTotp({ pendingToken: first.pendingToken, code: '000000' }, { ip: '127.0.0.1' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it('consumes a pending TOTP login token exactly once', async () => {
    const { codes, hashes } = await generateRecoveryCodes();
    const user = await userFixture({
      totpEnabled: true,
      totpSecret: 'JBSWY3DPEHPK3PXP',
      recoveryCodes: hashes,
    });
    const { service, store, sessions } = serviceFixture({ user });

    const first = await service.login(
      { username: 'admin', password: TEST_PASSWORD, remember: false },
      { ip: '127.0.0.1' },
    );
    if (first.kind !== 'totpRequired') throw new Error('expected pending TOTP login');

    const session = await service.loginTotp(
      { pendingToken: first.pendingToken, code: codes[0] },
      { ip: '127.0.0.1' },
    );

    expect(session.remember).toBe(false);
    expect(sessions).toHaveLength(1);
    expect(store.updateUser).toHaveBeenCalledWith(1, { recoveryCodes: hashes.slice(1) });

    await expect(
      service.loginTotp({ pendingToken: first.pendingToken, code: codes[0] }, { ip: '127.0.0.1' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(sessions).toHaveLength(1);
  });
});
