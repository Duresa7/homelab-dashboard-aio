import QRCode from 'qrcode';

import { SESSION_TTL_MS, sha256Hex, type AuthInfo } from './middleware.js';
import { hashPassword, validatePassword, verifyPassword } from './passwords.js';
import type { LoginRateLimiter } from './rate-limit.js';
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  randomToken,
  totpKeyUri,
  verifyTotpCode,
} from './totp.js';
import type { AuthStore, UserRecord } from './types.js';
import { isValidEmail, isValidUsername } from './user-profile.js';

const PENDING_TOTP_TTL_MS = 5 * 60 * 1000;

interface PendingTotpLogin {
  userId: number;
  username: string;
  remember: boolean;
  expiresAt: number;
}

export class AuthLifecycleError extends Error {
  status: number;
  retryAfterMs?: number;

  constructor(status: number, message: string, opts: { retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'AuthLifecycleError';
    this.status = status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export interface AuthRequestContext {
  ip?: string;
  userAgent?: string | null;
}

export interface StartedSession {
  user: UserRecord;
  token: string;
  remember: boolean;
}

export type LoginResult =
  | { kind: 'authenticated'; session: StartedSession }
  | { kind: 'totpRequired'; pendingToken: string };

export interface SessionLifecycleOptions {
  store: AuthStore;
  limiter: LoginRateLimiter;
  usersExist: () => Promise<boolean>;
  noteUserCreated: () => void;
  now?: () => number;
}

function bodyString(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? String(body[key]) : '';
}

function normalizeUsername(body: Record<string, unknown>): string {
  return bodyString(body, 'username').trim().toLowerCase();
}

function normalizeDisplayName(body: Record<string, unknown>, username: string): string {
  const displayName = bodyString(body, 'displayName').trim();
  return displayName ? displayName.slice(0, 80) : username;
}

function normalizeEmail(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function createSessionLifecycleService(opts: SessionLifecycleOptions) {
  const { store, limiter } = opts;
  const now = opts.now ?? Date.now;
  const pendingTotp = new Map<string, PendingTotpLogin>();

  async function startSession(
    ctx: AuthRequestContext,
    user: UserRecord,
    remember: boolean,
  ): Promise<StartedSession> {
    const token = randomToken();
    await store.createSession({
      id: randomToken(8),
      tokenHash: sha256Hex(token),
      userId: user.id,
      expiresAt: now() + SESSION_TTL_MS,
      remember,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
    });
    return { user, token, remember };
  }

  function rateLimitOrThrow(key: string): void {
    const decision = limiter.check(key);
    if (!decision.allowed) {
      throw new AuthLifecycleError(429, 'too many failed attempts — try again shortly', {
        retryAfterMs: decision.retryAfterMs,
      });
    }
  }

  async function bootstrap(
    body: Record<string, unknown>,
    ctx: AuthRequestContext,
  ): Promise<StartedSession> {
    if (await opts.usersExist()) {
      throw new AuthLifecycleError(403, 'an account already exists');
    }

    const username = normalizeUsername(body);
    const displayName = normalizeDisplayName(body, username);
    const email = normalizeEmail(body.email);
    const password = bodyString(body, 'password');

    if (!isValidUsername(username)) {
      throw new AuthLifecycleError(400, 'invalid username (a–z, 0–9, . _ -, max 32 chars)');
    }
    if (email !== null && !isValidEmail(email)) {
      throw new AuthLifecycleError(400, 'invalid email address');
    }
    const check = validatePassword(password, [username, displayName, email ?? '']);
    if (!check.ok) throw new AuthLifecycleError(400, check.reason);

    const user = await store.createUser({
      username,
      displayName,
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
    });
    opts.noteUserCreated();
    return startSession(ctx, user, true);
  }

  async function login(
    body: Record<string, unknown>,
    ctx: AuthRequestContext,
  ): Promise<LoginResult> {
    const username = normalizeUsername(body);
    const password = bodyString(body, 'password');
    const remember = body.remember !== false;
    if (!username || !password) {
      throw new AuthLifecycleError(400, 'username and password are required');
    }

    const key = limiter.key(ctx.ip, username);
    rateLimitOrThrow(key);

    const user = await store.getUserByUsername(username);
    if (!user) {
      await hashPassword(password).catch(() => {
        void 0;
      });
      limiter.recordFailure(key);
      console.warn(`Auth: failed login for unknown user "${username}" from ${ctx.ip}`);
      throw new AuthLifecycleError(401, 'invalid username or password');
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      limiter.recordFailure(key);
      console.warn(`Auth: failed login for "${username}" from ${ctx.ip}`);
      throw new AuthLifecycleError(401, 'invalid username or password');
    }

    limiter.recordSuccess(key);

    if (user.totpEnabled && user.totpSecret) {
      const pendingToken = randomToken();
      pendingTotp.set(pendingToken, {
        userId: user.id,
        username: user.username,
        remember,
        expiresAt: now() + PENDING_TOTP_TTL_MS,
      });
      return { kind: 'totpRequired', pendingToken };
    }

    return { kind: 'authenticated', session: await startSession(ctx, user, remember) };
  }

  async function loginTotp(
    body: Record<string, unknown>,
    ctx: AuthRequestContext,
  ): Promise<StartedSession> {
    const pendingToken = bodyString(body, 'pendingToken');
    const code = bodyString(body, 'code').trim();
    const pending = pendingTotp.get(pendingToken);
    if (!pending || pending.expiresAt < now()) {
      if (pending) pendingTotp.delete(pendingToken);
      throw new AuthLifecycleError(401, 'login expired — start over');
    }

    const key = limiter.key(ctx.ip, pending.username);
    rateLimitOrThrow(key);

    const user = await store.getUserById(pending.userId);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      pendingTotp.delete(pendingToken);
      throw new AuthLifecycleError(401, 'login expired — start over');
    }

    let ok = false;
    if (/^\d{6}$/.test(code.replace(/\s+/g, ''))) {
      ok = await verifyTotpCode(user.totpSecret, code);
    }
    if (!ok) {
      const remaining = await consumeRecoveryCode(user.recoveryCodes, code);
      if (remaining) {
        await store.updateUser(user.id, { recoveryCodes: remaining });
        ok = true;
      }
    }
    if (!ok) {
      limiter.recordFailure(key);
      console.warn(`Auth: failed TOTP for "${user.username}" from ${ctx.ip}`);
      throw new AuthLifecycleError(401, 'invalid code');
    }

    limiter.recordSuccess(key);
    pendingTotp.delete(pendingToken);
    return startSession(ctx, user, pending.remember);
  }

  async function logout(auth: AuthInfo): Promise<void> {
    if (auth.sessionId) await store.deleteSession(auth.sessionId);
  }

  async function changePassword(auth: AuthInfo, body: Record<string, unknown>): Promise<void> {
    const current = bodyString(body, 'current');
    const next = bodyString(body, 'next');
    if (!(await verifyPassword(auth.user.passwordHash, current))) {
      throw new AuthLifecycleError(403, 'current password is incorrect');
    }
    const check = validatePassword(next, [
      auth.user.username,
      auth.user.displayName,
      auth.user.email ?? '',
    ]);
    if (!check.ok) throw new AuthLifecycleError(400, check.reason);
    await store.updateUser(auth.user.id, { passwordHash: await hashPassword(next) });

    await store.deleteSessionsForUser(auth.user.id, {
      exceptSessionId: auth.sessionId ?? undefined,
    });
  }

  async function updateProfile(auth: AuthInfo, body: Record<string, unknown>): Promise<UserRecord> {
    const patch: { displayName?: string; email?: string | null } = {};
    if (typeof body.displayName === 'string' && body.displayName.trim()) {
      patch.displayName = body.displayName.trim().slice(0, 80);
    }
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (email !== null && !isValidEmail(email)) {
        throw new AuthLifecycleError(400, 'invalid email address');
      }
      patch.email = email;
    }
    await store.updateUser(auth.user.id, patch);
    return (await store.getUserById(auth.user.id)) ?? auth.user;
  }

  async function listSessions(auth: AuthInfo) {
    const sessions = await store.listSessionsForUser(auth.user.id);
    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      remember: s.remember,
      ip: s.ip,
      userAgent: s.userAgent,
      current: s.id === auth.sessionId,
    }));
  }

  async function revokeSession(auth: AuthInfo, id: string): Promise<{ current: boolean }> {
    const sessions = await store.listSessionsForUser(auth.user.id);
    const target = sessions.find((s) => s.id === id);
    if (!target) throw new AuthLifecycleError(404, 'not found');
    await store.deleteSession(target.id);
    return { current: target.id === auth.sessionId };
  }

  async function setupTotp(auth: AuthInfo) {
    if (auth.user.totpEnabled) {
      throw new AuthLifecycleError(409, 'two-factor auth is already enabled');
    }
    const secret = generateTotpSecret();
    await store.updateUser(auth.user.id, { totpSecret: secret, totpEnabled: false });
    const otpauthUrl = totpKeyUri(auth.user.username, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
    return { secret, otpauthUrl, qrDataUrl };
  }

  async function enableTotp(auth: AuthInfo, body: Record<string, unknown>): Promise<string[]> {
    const user = await store.getUserById(auth.user.id);
    const code = bodyString(body, 'code');
    if (!user?.totpSecret) {
      throw new AuthLifecycleError(400, 'run TOTP setup first');
    }
    if (user.totpEnabled) {
      throw new AuthLifecycleError(409, 'two-factor auth is already enabled');
    }
    if (!(await verifyTotpCode(user.totpSecret, code))) {
      throw new AuthLifecycleError(400, 'invalid code — scan the QR and try again');
    }
    const { codes, hashes } = await generateRecoveryCodes();
    await store.updateUser(user.id, { totpEnabled: true, recoveryCodes: hashes });
    return codes;
  }

  async function disableTotp(auth: AuthInfo, body: Record<string, unknown>): Promise<void> {
    const password = bodyString(body, 'password');
    if (!(await verifyPassword(auth.user.passwordHash, password))) {
      throw new AuthLifecycleError(403, 'password is incorrect');
    }
    await store.updateUser(auth.user.id, {
      totpEnabled: false,
      totpSecret: null,
      recoveryCodes: [],
    });
  }

  return {
    bootstrap,
    login,
    loginTotp,
    logout,
    changePassword,
    updateProfile,
    listSessions,
    revokeSession,
    setupTotp,
    enableTotp,
    disableTotp,
  };
}
