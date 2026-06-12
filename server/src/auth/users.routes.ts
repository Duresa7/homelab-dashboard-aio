import type { Express, Request, RequestHandler, Response } from 'express';

import { errorMessage } from '../lib/errors.js';
import { hashPassword, validatePassword } from './passwords.js';
import { isUserRole, type AuthStore } from './types.js';
import { isValidEmail, isValidUsername, publicUser } from './user-profile.js';

export interface UserRoutesOpts {
  store: AuthStore;
  sameOrigin: RequestHandler;
  jsonBody: RequestHandler;
}

export function registerUserRoutes(app: Express, opts: UserRoutesOpts): void {
  const { store, sameOrigin, jsonBody } = opts;

  const fail = (res: Response, err: unknown) => res.status(500).json({ error: errorMessage(err) });

  const userId = (req: Request): number | null => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  app.get('/api/users', async (_req: Request, res: Response) => {
    try {
      const users = await store.listUsers();
      res.json({ users: users.map(publicUser) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/users', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      const displayName =
        typeof body.displayName === 'string' && body.displayName.trim()
          ? body.displayName.trim().slice(0, 80)
          : username;
      const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
      const password = typeof body.password === 'string' ? body.password : '';
      const role = body.role;

      if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'invalid username (a–z, 0–9, . _ -, max 32 chars)' });
      }
      if (!isUserRole(role)) return res.status(400).json({ error: 'invalid role' });
      if (email !== null && !isValidEmail(email)) {
        return res.status(400).json({ error: 'invalid email address' });
      }
      const check = validatePassword(password, [username, displayName, email ?? '']);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      if (await store.getUserByUsername(username)) {
        return res.status(409).json({ error: 'username is already taken' });
      }

      const user = await store.createUser({
        username,
        displayName,
        email,
        passwordHash: await hashPassword(password),
        role,
      });
      res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.patch('/api/users/:id', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const id = userId(req);
      if (!id) return res.status(400).json({ error: 'invalid user id' });
      const user = await store.getUserById(id);
      if (!user) return res.status(404).json({ error: 'not found' });

      const body = req.body as Record<string, unknown>;
      const patch: { displayName?: string; email?: string | null; role?: typeof user.role } = {};

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
      if (body.role !== undefined) {
        if (!isUserRole(body.role)) return res.status(400).json({ error: 'invalid role' });
        if (user.role === 'admin' && body.role !== 'admin') {
          if ((await store.countAdmins({ excludeId: id })) === 0) {
            return res.status(409).json({ error: 'cannot demote the last admin' });
          }
        }
        patch.role = body.role;
      }

      await store.updateUser(id, patch);

      if (patch.role && patch.role !== user.role) {
        await store.deleteSessionsForUser(id, {
          exceptSessionId: req.auth?.user.id === id ? (req.auth.sessionId ?? undefined) : undefined,
        });
      }
      const fresh = await store.getUserById(id);
      res.json({ user: publicUser(fresh ?? user) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.delete('/api/users/:id', sameOrigin, async (req: Request, res: Response) => {
    try {
      const id = userId(req);
      if (!id) return res.status(400).json({ error: 'invalid user id' });
      const user = await store.getUserById(id);
      if (!user) return res.status(404).json({ error: 'not found' });
      if (user.role === 'admin' && (await store.countAdmins({ excludeId: id })) === 0) {
        return res.status(409).json({ error: 'cannot delete the last admin' });
      }
      await store.deleteUser(id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/users/:id/password', sameOrigin, jsonBody, async (req: Request, res: Response) => {
    try {
      const id = userId(req);
      if (!id) return res.status(400).json({ error: 'invalid user id' });
      const user = await store.getUserById(id);
      if (!user) return res.status(404).json({ error: 'not found' });
      const password =
        typeof (req.body as Record<string, unknown>).password === 'string'
          ? String((req.body as Record<string, unknown>).password)
          : '';
      const check = validatePassword(password, [user.username, user.displayName, user.email ?? '']);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      await store.updateUser(id, { passwordHash: await hashPassword(password) });

      await store.deleteSessionsForUser(id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/users/:id/revoke-sessions', sameOrigin, async (req: Request, res: Response) => {
    try {
      const id = userId(req);
      if (!id) return res.status(400).json({ error: 'invalid user id' });
      if (!(await store.getUserById(id))) return res.status(404).json({ error: 'not found' });
      const revoked = await store.deleteSessionsForUser(id);
      res.json({ ok: true, revoked });
    } catch (err) {
      fail(res, err);
    }
  });
}
