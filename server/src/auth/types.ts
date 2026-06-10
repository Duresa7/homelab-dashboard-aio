// Auth domain types and the AuthStore contract. Kept free of storage imports so
// storage/types.ts can re-export the contract without a cycle.

export type UserRole = 'admin' | 'member' | 'viewer';

export const USER_ROLES: UserRole[] = ['admin', 'member', 'viewer'];

export function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'member' || value === 'viewer';
}

export interface UserRecord {
  id: number;
  /** Login identifier, stored lowercase; displayName carries the user's casing. */
  username: string;
  displayName: string;
  email: string | null;
  passwordHash: string;
  role: UserRole;
  totpSecret: string | null;
  totpEnabled: boolean;
  /** Argon2 hashes of unused recovery codes. */
  recoveryCodes: string[];
  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
}

export interface NewUser {
  username: string;
  displayName: string;
  email: string | null;
  passwordHash: string;
  role: UserRole;
}

export interface UserPatch {
  displayName?: string;
  email?: string | null;
  passwordHash?: string;
  role?: UserRole;
  totpSecret?: string | null;
  totpEnabled?: boolean;
  recoveryCodes?: string[];
}

export interface SessionRecord {
  id: string;
  userId: number;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  remember: boolean;
  ip: string | null;
  userAgent: string | null;
}

export interface NewSession {
  id: string;
  /** SHA-256 hex of the raw cookie token — the raw token is never stored. */
  tokenHash: string;
  userId: number;
  expiresAt: number;
  remember: boolean;
  ip: string | null;
  userAgent: string | null;
}

/** Users + sessions store backing /api/auth and /api/users. */
export interface AuthStore {
  countUsers(): Promise<number>;
  countAdmins(opts?: { excludeId?: number }): Promise<number>;
  getUserById(id: number): Promise<UserRecord | null>;
  getUserByUsername(username: string): Promise<UserRecord | null>;
  listUsers(): Promise<UserRecord[]>;
  createUser(user: NewUser): Promise<UserRecord>;
  updateUser(id: number, patch: UserPatch): Promise<void>;
  deleteUser(id: number): Promise<void>;

  createSession(session: NewSession): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(id: string, lastUsedAt: number, expiresAt: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: number, opts?: { exceptSessionId?: string }): Promise<number>;
  listSessionsForUser(userId: number): Promise<SessionRecord[]>;
  deleteExpiredSessions(now: number): Promise<number>;
}
