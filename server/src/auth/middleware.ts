// The auth gate: default-deny for every /api route, with a small public
// allowlist and a central role-escalation matrix. Keeping the whole protection
// table in one file makes the policy reviewable and testable as a unit
// (see ADR 0006).
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { errorMessage } from '../lib/errors.js';
import { proxyAssertedUser, type ProxyAuthConfig } from './proxy-auth.js';
import type { AuthStore, UserRecord, UserRole } from './types.js';

export const SESSION_COOKIE = 'hd_session';
/** Sliding session lifetime. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Renewal writes are throttled so reads don't hammer the sessions table. */
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface AuthInfo {
  user: UserRecord;
  /** Null when authenticated via the reverse-proxy header (no local session). */
  sessionId: string | null;
  via: 'session' | 'proxy';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Cookie Secure flag: on for HTTPS requests (direct or via trusted proxy). */
export function requestIsSecure(req: Request): boolean {
  if (req.secure) return true;
  const xfp = req.headers['x-forwarded-proto'];
  const first = (Array.isArray(xfp) ? xfp[0] : xfp)?.split(',')[0]?.trim();
  return first === 'https';
}

const ROLE_ORDER: Record<UserRole, number> = { viewer: 0, member: 1, admin: 2 };

export function roleAtLeast(role: UserRole, min: UserRole): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[min];
}

/** API paths reachable without a session. /api/health is additionally
 * minimized for unauthenticated callers in its handler. */
const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/login/totp',
  '/api/auth/bootstrap',
]);

/**
 * Role-escalation matrix. The gate already requires a valid session for every
 * non-public /api route, so 'viewer' means "any authenticated user".
 */
export function requiredRoleFor(method: string, path: string): UserRole {
  const m = method === 'HEAD' ? 'GET' : method;

  // Debug endpoints reveal raw integration payloads, hosts, and DB stats.
  // (/api/debug is the legacy UniFi debug path.)
  if (path === '/api/debug' || path.endsWith('/debug')) return 'admin';

  if (path === '/api/users' || path.startsWith('/api/users/')) return 'admin';

  if (path.startsWith('/api/setup/')) {
    // Status + capability metadata drive non-admin UI states; they carry no
    // secrets or addresses. Everything else (config/db reads reveal hosts and
    // usernames; writes change integrations) is admin-only.
    if (path === '/api/setup/status' || path === '/api/setup/capabilities') return 'viewer';
    return 'admin';
  }

  if (path === '/api/state' || path.startsWith('/api/state/')) {
    return m === 'GET' ? 'viewer' : 'member';
  }

  if (path === '/api/wol/wake') return 'member';

  // Everything else (providers, sensors, siem, history, auth self-service) is
  // available to any authenticated user; mutating auth/user actions do their
  // own ownership checks in the handlers.
  return 'viewer';
}

export interface AuthService {
  /** Resolve the request's user via session cookie or trusted proxy header. */
  resolveAuth(req: Request): Promise<AuthInfo | null>;
  usersExist(): Promise<boolean>;
  /** Called after the bootstrap account is created. */
  noteUserCreated(): void;
  store: AuthStore;
}

export function createAuthService(store: AuthStore, proxy: ProxyAuthConfig): AuthService {
  // countUsers() is cached once true: users can only drop to zero via offline
  // CLI surgery, and a restart re-checks anyway.
  let usersExist: boolean | null = null;

  return {
    store,

    async usersExist(): Promise<boolean> {
      if (usersExist !== true) usersExist = (await store.countUsers()) > 0;
      return usersExist;
    },

    noteUserCreated(): void {
      usersExist = true;
    },

    async resolveAuth(req: Request): Promise<AuthInfo | null> {
      const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
      const token = cookies?.[SESSION_COOKIE];
      if (typeof token === 'string' && token.length > 0) {
        const now = Date.now();
        const session = await store.getSessionByTokenHash(sha256Hex(token));
        if (session && session.expiresAt > now) {
          const user = await store.getUserById(session.userId);
          if (user) {
            if (now - session.lastUsedAt > SESSION_TOUCH_INTERVAL_MS) {
              // Sliding renewal; failure here must not fail the request.
              void store.touchSession(session.id, now, now + SESSION_TTL_MS).catch(() => {});
            }
            return { user, sessionId: session.id, via: 'session' };
          }
        }
      }

      if (proxy.enabled) {
        const username = proxyAssertedUser(proxy, req.ip, req.headers[proxy.header]);
        if (username) {
          const user = await store.getUserByUsername(username);
          if (user) return { user, sessionId: null, via: 'proxy' };
        }
      }

      return null;
    },
  };
}

export function createAuthGate(service: AuthService) {
  return async function authGate(req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith('/api/')) return next();

    try {
      const auth = await service.resolveAuth(req);
      if (auth) req.auth = auth;
    } catch (err) {
      console.error(`Auth: session resolution failed - ${errorMessage(err)}`);
    }

    if (PUBLIC_API_PATHS.has(req.path)) return next();

    if (!req.auth) {
      // Surface bootstrap mode so the client can route to account creation.
      let bootstrap = false;
      try {
        bootstrap = !(await service.usersExist());
      } catch {
        /* DB error — plain 401 */
      }
      return res
        .status(401)
        .json(
          bootstrap
            ? { error: 'authentication required', bootstrap: true }
            : { error: 'authentication required' },
        );
    }

    const required = requiredRoleFor(req.method, req.path);
    if (!roleAtLeast(req.auth.user.role, required)) {
      return res.status(403).json({ error: 'insufficient permissions' });
    }

    return next();
  };
}

/** Installed instead of the gate when the database failed to open: the API
 * cannot authenticate anyone, so it fails closed. */
export function createUnavailableGate() {
  return function unavailableGate(req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path === '/api/health') return next();
    return res.status(503).json({ error: 'state database unavailable' });
  };
}
