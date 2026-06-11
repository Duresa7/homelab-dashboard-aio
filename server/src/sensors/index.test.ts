import { describe, it, expect } from 'vitest';
import type { Express } from 'express';
import { initSensors } from './index.js';

type StoredHandler = (req: unknown, res: unknown) => unknown;

function makeApp() {
  const routes: Record<string, StoredHandler> = {};
  return {
    routes,
    get(path: string, handler: StoredHandler) {
      routes[path] = handler;
    },
  };
}
function makeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown as { error?: string },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj as { error?: string };
      return this;
    },
  };
}

const DISABLED_CONFIG = {
  enabled: false,
  mode: 'local',
  sshHost: '',
  sshUser: '',
  sshPort: 22,
  sshKeyPath: '',
  cacheTtl: 5000,
};

describe('initSensors — I/O edge wiring', () => {
  it('registers both sensor routes and returns a probe handle', () => {
    const app = makeApp();
    const handle = initSensors(app as unknown as Express, DISABLED_CONFIG);
    expect(app.routes['/api/sensors']).toBeTypeOf('function');
    expect(app.routes['/api/sensors/debug']).toBeTypeOf('function');
    expect(handle.runSensors).toBeTypeOf('function');
    expect(handle.fetchSensorsData).toBeTypeOf('function');
  });

  it('short-circuits to {disabled:true} when the integration is off (no shell-out)', async () => {
    const app = makeApp();
    initSensors(app as unknown as Express, DISABLED_CONFIG);

    const res = makeRes();
    await app.routes['/api/sensors']({}, res);
    expect(res.body).toEqual({ disabled: true });
  });

  it('hides the debug route by default', async () => {
    const app = makeApp();
    initSensors(app as unknown as Express, DISABLED_CONFIG);

    const dbg = makeRes();
    await app.routes['/api/sensors/debug']({}, dbg);
    expect(dbg.statusCode).toBe(404);
    expect(dbg.body).toEqual({ error: 'Not found' });
  });

  it('returns 503 when SSH mode has no host configured', async () => {
    const app = makeApp();
    initSensors(app as unknown as Express, {
      ...DISABLED_CONFIG,
      enabled: true,
      mode: 'ssh',
      sshHost: '',
    });

    const res = makeRes();
    await app.routes['/api/sensors']({}, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/no host configured/i);
  });
});
