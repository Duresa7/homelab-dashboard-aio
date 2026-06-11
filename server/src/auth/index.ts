import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import QRCode from 'qrcode';

import { errorMessage } from '../lib/errors.js';
import { makeSameOriginGuard } from '../state/index.js';
import {
  createAuthGate,
  createAuthService,
  requestIsSecure,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type AuthService,
} from './middleware.js';
import { sha256Hex } from './middleware.js';
import { hashPassword, validatePassword, verifyPassword } from './passwords.js';
import { parseProxyAuthConfig } from './proxy-auth.js';
import { createLoginRateLimiter, type LoginRateLimiter } from './rate-limit.js';
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  randomToken,
  totpKeyUri,
  verifyTotpCode,
} from './totp.js';
import { registerUserRoutes } from './users.routes.js';
import type { AuthStore, UserRecord } from './types.js';

const PENDING_TOTP_TTL_MS = 5 * 60 * 1000;
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/;

export function publicUser(u: UserRecord) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    role: u.role,
    totpEnabled: u.totpEnabled,
    createdAt: u.createdAt,
    passwordChangedAt: u.passwordChangedAt,
  };
}

export function isValidUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_RE.test(value.toLowerCase());
}

export function isValidEmail(value: unknown): boolean {
  return (
    typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

interface PendingTotpLogin {
  userId: number;
  username: string;
  remember: boolean;
  expiresAt: number;
}

export interface AuthHandle {
  service: AuthService;
  shutdown(): void;
}

export interface InitAuthOpts {
  auth: AuthStore;
  rateLimiter?: LoginRateLimiter;
  env?: NodeJS.ProcessEnv;
}

export function initAuth(app: Express, opts: InitAuthOpts): AuthHandle {
  const store = opts.auth;
  const proxy = parseProxyAuthConfig(opts.env ?? process.env);
  const service = createAuthService(store, proxy);
  const limiter = opts.rateLimiter ?? createLoginRateLimiter();
  const pendingTotp = new Map<string, PendingTotpLogin>();

  if (proxy.enabled) {
    console.log(
      `Auth: proxy auth enabled — header "${proxy.header}" trusted from [${[...proxy.trustedIps].join(', ')}]`,
    );
  }

  app.use(cookieParser());
  app.use(createAuthGate(service));

  const jsonBody = express.json({ limit: '64kb' });
  const sameOrigin = makeSameOriginGuard();

  const setSessionCookie = (req: Request, res: Response, token: string, remember: boolean) => {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: requestIsSecure(req),

      ...(remember ? { maxAge: SESSION_TTL_MS } : {}),
    });
  };

  const clearSessionCookie = (res: Response) => {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
  };

  const startSession = async (req: Request, res: Response, user: UserRecord, remember: boolean) => {
    const token = randomToken();
    await store.createSession({
      id: randomToken(8),
      tokenHash: sha256Hex(token),
      userId: user.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
      remember,
      ip: req.ip ?? null,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent'].slice(0, 300)
          : null,
    });
    setSessionCookie(req, res, token, remember);
  };

  const sweep = () => {
    void store.deleteExpiredSessions(Date.now()).catch(() => {
      void 0;
    });
  };
  sweep();
  const sweepTimer = setInterval(sweep, 24 * 60 * 60 * 1000);
  sweepTimer.unref?.();

  app.get('/api/auth/status', async (req: Request, res: Response) => {
    try {
      const usersExist = await service.usersExist();
      const auth = req.auth ?? null;
      res.json({
        usersExist,
        authenticated: !!auth,
        ...(auth ? { user: publicUser(auth.user), via: auth.via } : {}),
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/auth/bootstrap', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      if (await service.usersExist()) {
        return res.status(403).json({ error: 'an account already exists' });
      }
      const body = req.body as Record<string, unknown>;
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      const displayName =
        typeof body.displayName === 'string' && body.displayName.trim()
          ? body.displayName.trim().slice(0, 80)
          : username;
      const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
      const password = typeof body.password === 'string' ? body.password : '';

      if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'invalid username (a–z, 0–9, . _ -, max 32 chars)' });
      }
      if (email !== null && !isValidEmail(email)) {
        return res.status(400).json({ error: 'invalid email address' });
      }
      const check = validatePassword(password, [username, displayName, email ?? '']);
      if (!check.ok) return res.status(400).json({ error: check.reason });

      const user = await store.createUser({
        username,
        displayName,
        email,
        passwordHash: await hashPassword(password),
        role: 'admin',
      });
      service.noteUserCreated();
      await startSession(req, res, user, true);
      console.log(`Auth: bootstrap admin account "${username}" created`);
      res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/auth/login', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const remember = body.remember !== false;
      if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required' });
      }

      const key = limiter.key(req.ip, username);
      const decision = limiter.check(key);
      if (!decision.allowed) {
        res.set('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)));
        return res.status(429).json({
          error: 'too many failed attempts — try again shortly',
          retryAfterMs: decision.retryAfterMs,
        });
      }

      const user = await store.getUserByUsername(username);
      if (!user) {
        await hashPassword(password).catch(() => {
          void 0;
        });
        limiter.recordFailure(key);
        console.warn(`Auth: failed login for unknown user "${username}" from ${req.ip}`);
        return res.status(401).json({ error: 'invalid username or password' });
      }

      if (!(await verifyPassword(user.passwordHash, password))) {
        limiter.recordFailure(key);
        console.warn(`Auth: failed login for "${username}" from ${req.ip}`);
        return res.status(401).json({ error: 'invalid username or password' });
      }

      limiter.recordSuccess(key);

      if (user.totpEnabled && user.totpSecret) {
        const pendingToken = randomToken();
        pendingTotp.set(pendingToken, {
          userId: user.id,
          username: user.username,
          remember,
          expiresAt: Date.now() + PENDING_TOTP_TTL_MS,
        });
        return res.json({ totpRequired: true, pendingToken });
      }

      await startSession(req, res, user, remember);
      res.json({ user: publicUser(user) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/auth/login/totp', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const pendingToken = typeof body.pendingToken === 'string' ? body.pendingToken : '';
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      const pending = pendingTotp.get(pendingToken);
      if (!pending || pending.expiresAt < Date.now()) {
        if (pending) pendingTotp.delete(pendingToken);
        return res.status(401).json({ error: 'login expired — start over' });
      }

      const key = limiter.key(req.ip, pending.username);
      const decision = limiter.check(key);
      if (!decision.allowed) {
        res.set('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)));
        return res.status(429).json({
          error: 'too many failed attempts — try again shortly',
          retryAfterMs: decision.retryAfterMs,
        });
      }

      const user = await store.getUserById(pending.userId);
      if (!user || !user.totpEnabled || !user.totpSecret) {
        pendingTotp.delete(pendingToken);
        return res.status(401).json({ error: 'login expired — start over' });
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
        console.warn(`Auth: failed TOTP for "${user.username}" from ${req.ip}`);
        return res.status(401).json({ error: 'invalid code' });
      }

      limiter.recordSuccess(key);
      pendingTotp.delete(pendingToken);
      await startSession(req, res, user, pending.remember);
      res.json({ user: publicUser(user) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const auth = req.auth!;
    res.json({ user: publicUser(auth.user), via: auth.via });
  });

  app.post('/api/auth/logout', sameOrigin, async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      if (auth.sessionId) await store.deleteSession(auth.sessionId);
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post(
    '/api/auth/change-password',
    sameOrigin,
    jsonBody,
    async (req: Request, res: Response) => {
      try {
        const auth = req.auth!;
        const body = req.body as Record<string, unknown>;
        const current = typeof body.current === 'string' ? body.current : '';
        const next = typeof body.next === 'string' ? body.next : '';
        if (!(await verifyPassword(auth.user.passwordHash, current))) {
          return res.status(403).json({ error: 'current password is incorrect' });
        }
        const check = validatePassword(next, [
          auth.user.username,
          auth.user.displayName,
          auth.user.email ?? '',
        ]);
        if (!check.ok) return res.status(400).json({ error: check.reason });
        await store.updateUser(auth.user.id, { passwordHash: await hashPassword(next) });

        await store.deleteSessionsForUser(auth.user.id, {
          exceptSessionId: auth.sessionId ?? undefined,
        });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: errorMessage(err) });
      }
    },
  );

  app.post('/api/auth/profile', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const body = req.body as Record<string, unknown>;
      const patch: { displayName?: string; email?: string | null } = {};
      if (typeof body.displayName === 'string' && body.displayName.trim()) {
        patch.displayName = body.displayName.trim().slice(0, 80);
      }
      if (body.email !== undefined) {
        const email =
          typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
        if (email !== null && !isValidEmail(email)) {
          return res.status(400).json({ error: 'invalid email address' });
        }
        patch.email = email;
      }
      await store.updateUser(auth.user.id, patch);
      const fresh = await store.getUserById(auth.user.id);
      res.json({ user: publicUser(fresh ?? auth.user) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/auth/sessions', async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const sessions = await store.listSessionsForUser(auth.user.id);
      res.json({
        sessions: sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          expiresAt: s.expiresAt,
          remember: s.remember,
          ip: s.ip,
          userAgent: s.userAgent,
          current: s.id === auth.sessionId,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.delete('/api/auth/sessions/:id', sameOrigin, async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const sessions = await store.listSessionsForUser(auth.user.id);
      const target = sessions.find((s) => s.id === req.params.id);
      if (!target) return res.status(404).json({ error: 'not found' });
      await store.deleteSession(target.id);
      if (target.id === auth.sessionId) clearSessionCookie(res);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/auth/totp/setup', sameOrigin, async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      if (auth.user.totpEnabled) {
        return res.status(409).json({ error: 'two-factor auth is already enabled' });
      }
      const secret = generateTotpSecret();
      await store.updateUser(auth.user.id, { totpSecret: secret, totpEnabled: false });
      const otpauthUrl = totpKeyUri(auth.user.username, secret);
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
      res.json({ secret, otpauthUrl, qrDataUrl });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/auth/totp/enable', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const user = await store.getUserById(auth.user.id);
      const code =
        typeof (req.body as Record<string, unknown>).code === 'string'
          ? String((req.body as Record<string, unknown>).code)
          : '';
      if (!user?.totpSecret) {
        return res.status(400).json({ error: 'run TOTP setup first' });
      }
      if (user.totpEnabled) {
        return res.status(409).json({ error: 'two-factor auth is already enabled' });
      }
      if (!(await verifyTotpCode(user.totpSecret, code))) {
        return res.status(400).json({ error: 'invalid code — scan the QR and try again' });
      }
      const { codes, hashes } = await generateRecoveryCodes();
      await store.updateUser(user.id, { totpEnabled: true, recoveryCodes: hashes });

      res.json({ ok: true, recoveryCodes: codes });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/auth/totp/disable', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const password =
        typeof (req.body as Record<string, unknown>).password === 'string'
          ? String((req.body as Record<string, unknown>).password)
          : '';
      if (!(await verifyPassword(auth.user.passwordHash, password))) {
        return res.status(403).json({ error: 'password is incorrect' });
      }
      await store.updateUser(auth.user.id, {
        totpEnabled: false,
        totpSecret: null,
        recoveryCodes: [],
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  registerUserRoutes(app, { store, sameOrigin, jsonBody });

  return {
    service,
    shutdown() {
      clearInterval(sweepTimer);
    },
  };
}
