import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

const ENV_KEYS = [
  'NODE_ENV',
  'DISABLE_ALL',
  'STATE_DB_PATH',
  'SIEM_ENABLED',
  'UNIFI_ENABLED',
  'UNIFI_BASE_URL',
  'UNIFI_API_KEY',
  'UNIFI_SITE',
  'PORTAINER_ENABLED',
  'PORTAINER_BASE_URL',
  'PORTAINER_API_KEY',
  'PORTAINER_STATS_ENABLED',
  'PROXMOX_ENABLED',
  'PROXMOX_BASE_URL',
  'PROXMOX_TOKEN_ID',
  'PROXMOX_TOKEN_SECRET',
  'PROXMOX_NODE',
  'UNAS_ENABLED',
  'UNAS_BASE_URL',
  'UNAS_API_KEY',
  'PROTECT_ENABLED',
  'PROTECT_BASE_URL',
  'PROTECT_API_KEY',
  'PROTECT_EVENTS_ENABLED',
  'GPU_ENABLED',
  'GPU_MODE',
  'GPU_SSH_HOST',
  'SENSORS_ENABLED',
  'SENSORS_MODE',
  'SENSORS_SSH_HOST',
];

export async function loadServerApp(env = {}) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-dashboard-test-'));

  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: 'test',
    STATE_DB_PATH: path.join(tempDir, 'state.sqlite'),
    SIEM_ENABLED: 'false',
    UNIFI_ENABLED: 'false',
    PORTAINER_ENABLED: 'false',
    PROXMOX_ENABLED: 'false',
    UNAS_ENABLED: 'false',
    PROTECT_ENABLED: 'false',
    PROTECT_EVENTS_ENABLED: 'false',
    GPU_ENABLED: 'false',
    SENSORS_ENABLED: 'false',
    ...env,
  });

  vi.resetModules();
  const mod = await import('../index.js');

  async function cleanup() {
    try {
      mod.shutdownProtect?.();
      mod.sensorsHandle?.shutdown?.();
      mod.siemHandle?.shutdown?.();
      mod.stateHandle?.shutdown?.();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  return { app: mod.app, cleanup };
}

export async function withJsonUpstream(routes, fn) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://upstream.test');
    const route = routes[`${req.method} ${url.pathname}`] ?? routes[url.pathname];

    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No test route for ${req.method} ${url.pathname}` }));
      return;
    }

    try {
      const body = typeof route === 'function' ? route({ req, url }) : route;
      const status = body?.statusCode ?? 200;
      const payload = body && 'body' in body ? body.body : body;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}
