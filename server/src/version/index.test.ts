import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'APP_VERSION',
  'APP_COMMIT',
  'APP_BUILD_TIME',
  'DISABLE_ALL',
  'GITHUB_TOKEN',
  'UPDATE_CHECK_ENABLED',
  'UPDATE_REPO',
];
const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

async function updateStatusFor({
  current,
  latest,
}: {
  current?: string;
  latest: string;
}): Promise<Record<string, unknown>> {
  vi.resetModules();
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.UPDATE_CHECK_ENABLED = 'true';
  process.env.UPDATE_REPO = 'Duresa7/homelab-dashboard-aio';
  if (current !== undefined) process.env.APP_VERSION = current;

  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        tag_name: latest,
        name: `Release ${latest}`,
        html_url: `https://example.test/releases/${latest}`,
        published_at: '2026-01-01T00:00:00Z',
        body: 'notes',
      }),
    ),
  );

  const { registerVersionRoutes } = await import('./index.js');
  const app = express();
  const sameOrigin: RequestHandler = (_req, _res, next) => next();
  registerVersionRoutes(app, { sameOrigin });

  const res = await request(app).post('/api/update/check').expect(200);
  return res.body as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('update status version comparison', () => {
  it.each([
    { latest: '1.0.0', current: '0.9.9', outdated: true },
    { latest: '0.2.0', current: '0.1.0', outdated: true },
    { latest: '0.1.1', current: '0.1.0', outdated: true },
    { latest: '0.1.0', current: '0.1.0', outdated: false },
    { latest: '0.1.0', current: '0.2.0', outdated: false },
    { latest: '0.9.9', current: '1.0.0', outdated: false },
    { latest: 'v0.2.0', current: '0.1.0', outdated: true },
    { latest: 'v1.0.0', current: 'v1.0.0', outdated: false },
    { latest: '1.0.0', current: '1.0.0-rc.1', outdated: true },
    { latest: '1.0.0-rc.1', current: '1.0.0', outdated: false },
    { latest: '1.0.0-rc.2', current: '1.0.0-rc.1', outdated: true },
    { latest: '1.0.0-rc.1', current: '1.0.0-rc.2', outdated: false },
    { latest: '1.0.0-beta', current: '1.0.0-alpha', outdated: true },
    { latest: 'garbage', current: '0.1.0', outdated: false },
    { latest: '0.2.0', current: 'not-a-version', outdated: false },
  ])(
    'reports latest $latest against current $current as outdated=$outdated',
    async ({ latest, current, outdated }) => {
      const status = await updateStatusFor({ latest, current });

      expect(status).toMatchObject({
        current,
        latest,
        isOutdated: outdated,
        enabled: true,
        isDevBuild: false,
      });
    },
  );

  it('does not nag dev builds about releases', async () => {
    const status = await updateStatusFor({ latest: '999.0.0' });

    expect(status.isDevBuild).toBe(true);
    expect(status.isOutdated).toBe(false);
  });
});
