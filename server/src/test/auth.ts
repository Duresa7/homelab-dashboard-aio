// Auth helpers for server tests: bootstrap the first admin and hand back
// supertest agents that carry the session cookie. Every loadServerApp() boot
// starts with zero users, so each test bootstraps its own accounts.
import type { Express } from 'express';
import request from 'supertest';

import type { UserRole } from '../auth/types.js';

/** Strong enough for the zxcvbn policy, stable across suites. */
export const TEST_PASSWORD = 'plasma otter veranda 9 quilt';

export type AuthedAgent = ReturnType<typeof request.agent>;

/** Create the first admin account and return an agent logged in as it. */
export async function bootstrapAdmin(
  app: Express,
  opts: { username?: string } = {},
): Promise<AuthedAgent> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/bootstrap')
    .send({
      username: opts.username ?? 'admin',
      displayName: 'Test Admin',
      password: TEST_PASSWORD,
    })
    .expect(201);
  return agent;
}

/**
 * Return an agent logged in with the given role. Bootstraps the admin first
 * (or reuses one via `opts.admin`) and creates the secondary account with it.
 */
export async function authedAgent(
  app: Express,
  role: UserRole,
  opts: { admin?: AuthedAgent } = {},
): Promise<AuthedAgent> {
  const admin = opts.admin ?? (await bootstrapAdmin(app));
  if (role === 'admin') return admin;

  const username = `test-${role}`;
  await admin
    .post('/api/users')
    .send({ username, displayName: `Test ${role}`, password: TEST_PASSWORD, role })
    .expect(201);

  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username, password: TEST_PASSWORD }).expect(200);
  return agent;
}
