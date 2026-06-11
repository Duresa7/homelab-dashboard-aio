import type { Express } from 'express';
import request from 'supertest';

import type { UserRole } from '../auth/types.js';

export const TEST_PASSWORD = 'plasma otter veranda 9 quilt';

export type AuthedAgent = ReturnType<typeof request.agent>;

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
