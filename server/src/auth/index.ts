import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';

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
import { parseProxyAuthConfig } from './proxy-auth.js';
import { createLoginRateLimiter, type LoginRateLimiter } from './rate-limit.js';
import {
  AuthLifecycleError,
  createSessionLifecycleService,
  type AuthRequestContext,
  type StartedSession,
} from './session-lifecycle.js';
import { registerUserRoutes } from './users.routes.js';
import type { AuthStore } from './types.js';
import { publicUser } from './user-profile.js';

export { isValidEmail, isValidUsername, publicUser } from './user-profile.js';

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
  const lifecycle = createSessionLifecycleService({
    store,
    limiter,
    usersExist: () => service.usersExist(),
    noteUserCreated: () => service.noteUserCreated(),
  });

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

  const requestContext = (req: Request): AuthRequestContext => ({
    ip: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });

  const applySession = (req: Request, res: Response, session: StartedSession) => {
    setSessionCookie(req, res, session.token, session.remember);
  };

  const fail = (res: Response, err: unknown) => {
    if (err instanceof AuthLifecycleError) {
      if (err.retryAfterMs) res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
      return res.status(err.status).json({
        error: err.message,
        ...(err.retryAfterMs ? { retryAfterMs: err.retryAfterMs } : {}),
      });
    }
    return res.status(500).json({ error: errorMessage(err) });
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
      const session = await lifecycle.bootstrap(
        req.body as Record<string, unknown>,
        requestContext(req),
      );
      applySession(req, res, session);
      console.log(`Auth: bootstrap admin account "${session.user.username}" created`);
      res.status(201).json({ user: publicUser(session.user) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/auth/login', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const result = await lifecycle.login(
        req.body as Record<string, unknown>,
        requestContext(req),
      );
      if (result.kind === 'totpRequired') {
        return res.json({ totpRequired: true, pendingToken: result.pendingToken });
      }
      applySession(req, res, result.session);
      res.json({ user: publicUser(result.session.user) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/auth/login/totp', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const session = await lifecycle.loginTotp(
        req.body as Record<string, unknown>,
        requestContext(req),
      );
      applySession(req, res, session);
      res.json({ user: publicUser(session.user) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const auth = req.auth!;
    res.json({ user: publicUser(auth.user), via: auth.via });
  });

  app.post('/api/auth/logout', sameOrigin, async (req: Request, res: Response) => {
    try {
      await lifecycle.logout(req.auth!);
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post(
    '/api/auth/change-password',
    sameOrigin,
    jsonBody,
    async (req: Request, res: Response) => {
      try {
        await lifecycle.changePassword(req.auth!, req.body as Record<string, unknown>);
        res.json({ ok: true });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  app.post('/api/auth/profile', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const user = await lifecycle.updateProfile(req.auth!, req.body as Record<string, unknown>);
      res.json({ user: publicUser(user) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/auth/sessions', async (req: Request, res: Response) => {
    try {
      res.json({ sessions: await lifecycle.listSessions(req.auth!) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.delete('/api/auth/sessions/:id', sameOrigin, async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await lifecycle.revokeSession(req.auth!, id);
      if (result.current) clearSessionCookie(res);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/auth/totp/setup', sameOrigin, async (req: Request, res: Response) => {
    try {
      res.json(await lifecycle.setupTotp(req.auth!));
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/auth/totp/enable', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const recoveryCodes = await lifecycle.enableTotp(
        req.auth!,
        req.body as Record<string, unknown>,
      );
      res.json({ ok: true, recoveryCodes });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/auth/totp/disable', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      await lifecycle.disableTotp(req.auth!, req.body as Record<string, unknown>);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
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
