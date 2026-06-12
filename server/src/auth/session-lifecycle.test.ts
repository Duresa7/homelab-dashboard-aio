import { describe, expect, it, vi } from 'vitest';

import { hashPassword } from './passwords.js';
import { createLoginRateLimiter } from './rate-limit.js';
import { createSessionLifecycleService } from './session-lifecycle.js';
import type { AuthStore, NewSession, UserRecord } from './types.js';

const TEST_PASSWORD = 'granite parka mezzanine 7 fox';

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
      updateUser: vi.fn(),
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

describe('auth session lifecycle service', () => {
  it('logs in with normalized credentials and creates a session', async () => {
    const user: UserRecord = {
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
    };
    const { store, sessions } = storeFixture(user);
    const service = createSessionLifecycleService({
      store,
      limiter: createLoginRateLimiter({ now: () => 1_000 }),
      usersExist: async () => true,
      noteUserCreated: vi.fn(),
      now: () => 1_000,
    });

    const result = await service.login(
      { username: ' ADMIN ', password: TEST_PASSWORD, remember: false },
      { ip: '127.0.0.1', userAgent: 'vitest' },
    );

    expect(result.kind).toBe('authenticated');
    expect(store.getUserByUsername).toHaveBeenCalledWith('admin');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      userId: 1,
      remember: false,
      ip: '127.0.0.1',
      userAgent: 'vitest',
      expiresAt: 1_000 + 30 * 24 * 60 * 60 * 1000,
    });
  });
});
