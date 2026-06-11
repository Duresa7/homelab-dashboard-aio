import type { Kysely } from 'kysely';

import type { StateDatabase } from '../state/db.js';
import type { DbDriver } from '../storage/config.js';
import {
  isUserRole,
  type AuthStore,
  type NewSession,
  type NewUser,
  type SessionRecord,
  type UserPatch,
  type UserRecord,
  type UserRole,
} from './types.js';

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  password_hash: string;
  role: string;
  totp_secret: string | null;
  totp_enabled: number;
  recovery_codes: string;
  created_at: number;
  updated_at: number;
  password_changed_at: number;
}

function toUser(row: UserRow): UserRecord {
  let recoveryCodes: string[] = [];
  try {
    const parsed = JSON.parse(row.recovery_codes) as unknown;
    if (Array.isArray(parsed)) recoveryCodes = parsed.filter((c) => typeof c === 'string');
  } catch {
    void 0;
  }
  const role: UserRole = isUserRole(row.role) ? row.role : 'viewer';
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    passwordHash: row.password_hash,
    role,
    totpSecret: row.totp_secret,
    totpEnabled: Number(row.totp_enabled) !== 0,
    recoveryCodes,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    passwordChangedAt: Number(row.password_changed_at),
  };
}

function toSession(row: {
  id: string;
  user_id: number;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  remember: number;
  ip: string | null;
  user_agent: string | null;
}): SessionRecord {
  return {
    id: row.id,
    userId: Number(row.user_id),
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
    expiresAt: Number(row.expires_at),
    remember: Number(row.remember) !== 0,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

const USER_COLUMNS = [
  'id',
  'username',
  'display_name',
  'email',
  'password_hash',
  'role',
  'totp_secret',
  'totp_enabled',
  'recovery_codes',
  'created_at',
  'updated_at',
  'password_changed_at',
] as const;

const SESSION_COLUMNS = [
  'id',
  'user_id',
  'created_at',
  'last_used_at',
  'expires_at',
  'remember',
  'ip',
  'user_agent',
] as const;

export function createAuthStore(db: Kysely<StateDatabase>, driver: DbDriver): AuthStore {
  void driver;
  const getUserByUsername = async (username: string): Promise<UserRecord | null> => {
    const row = await db
      .selectFrom('users')
      .select(USER_COLUMNS)
      .where('username', '=', username.toLowerCase())
      .executeTakeFirst();
    return row ? toUser(row) : null;
  };

  return {
    async countUsers(): Promise<number> {
      const row = await db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll().as('n'))
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    async countAdmins(opts?: { excludeId?: number }): Promise<number> {
      let q = db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('role', '=', 'admin');
      if (opts?.excludeId !== undefined) q = q.where('id', '!=', opts.excludeId);
      const row = await q.executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    async getUserById(id: number): Promise<UserRecord | null> {
      const row = await db
        .selectFrom('users')
        .select(USER_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toUser(row) : null;
    },

    getUserByUsername,

    async listUsers(): Promise<UserRecord[]> {
      const rows = await db.selectFrom('users').select(USER_COLUMNS).orderBy('id').execute();
      return rows.map(toUser);
    },

    async createUser(user: NewUser): Promise<UserRecord> {
      const now = Date.now();
      const values = {
        username: user.username.toLowerCase(),
        display_name: user.displayName,
        email: user.email,
        password_hash: user.passwordHash,
        role: user.role,
        totp_secret: null,
        totp_enabled: 0,
        recovery_codes: '[]',
        created_at: now,
        updated_at: now,
        password_changed_at: now,
      };

      await db.insertInto('users').values(values).execute();
      const created = await getUserByUsername(user.username);
      if (!created) throw new Error('user insert did not persist');
      return created;
    },

    async updateUser(id: number, patch: UserPatch): Promise<void> {
      const set: Record<string, unknown> = { updated_at: Date.now() };
      if (patch.displayName !== undefined) set.display_name = patch.displayName;
      if (patch.email !== undefined) set.email = patch.email;
      if (patch.passwordHash !== undefined) {
        set.password_hash = patch.passwordHash;
        set.password_changed_at = Date.now();
      }
      if (patch.role !== undefined) set.role = patch.role;
      if (patch.totpSecret !== undefined) set.totp_secret = patch.totpSecret;
      if (patch.totpEnabled !== undefined) set.totp_enabled = patch.totpEnabled ? 1 : 0;
      if (patch.recoveryCodes !== undefined)
        set.recovery_codes = JSON.stringify(patch.recoveryCodes);
      await db.updateTable('users').set(set).where('id', '=', id).execute();
    },

    async deleteUser(id: number): Promise<void> {
      await db.deleteFrom('sessions').where('user_id', '=', id).execute();
      await db.deleteFrom('users').where('id', '=', id).execute();
    },

    async createSession(session: NewSession): Promise<void> {
      const now = Date.now();
      await db
        .insertInto('sessions')
        .values({
          id: session.id,
          token_hash: session.tokenHash,
          user_id: session.userId,
          created_at: now,
          last_used_at: now,
          expires_at: session.expiresAt,
          remember: session.remember ? 1 : 0,
          ip: session.ip,
          user_agent: session.userAgent,
        })
        .execute();
    },

    async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
      const row = await db
        .selectFrom('sessions')
        .select(SESSION_COLUMNS)
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row ? toSession(row) : null;
    },

    async touchSession(id: string, lastUsedAt: number, expiresAt: number): Promise<void> {
      await db
        .updateTable('sessions')
        .set({ last_used_at: lastUsedAt, expires_at: expiresAt })
        .where('id', '=', id)
        .execute();
    },

    async deleteSession(id: string): Promise<void> {
      await db.deleteFrom('sessions').where('id', '=', id).execute();
    },

    async deleteSessionsForUser(
      userId: number,
      opts?: { exceptSessionId?: string },
    ): Promise<number> {
      let q = db.deleteFrom('sessions').where('user_id', '=', userId);
      if (opts?.exceptSessionId) q = q.where('id', '!=', opts.exceptSessionId);
      const res = await q.executeTakeFirst();
      return Number(res.numDeletedRows ?? 0);
    },

    async listSessionsForUser(userId: number): Promise<SessionRecord[]> {
      const rows = await db
        .selectFrom('sessions')
        .select(SESSION_COLUMNS)
        .where('user_id', '=', userId)
        .orderBy('last_used_at', 'desc')
        .execute();
      return rows.map(toSession);
    },

    async deleteExpiredSessions(now: number): Promise<number> {
      const res = await db.deleteFrom('sessions').where('expires_at', '<', now).executeTakeFirst();
      return Number(res.numDeletedRows ?? 0);
    },
  };
}
