import { describe, it, expect } from 'vitest';
import type { Express } from 'express';
import { initSensors } from './index.js';

// Stored route handlers are called in-test with fake req/res, so they're
// typed loosely (the real handlers are typed in ./index.ts).
type StoredHandler = (req: unknown, res: unknown) => unknown;

// Minimal Express stand-ins — capture registered route handlers and the
// response so we can exercise initSensors' wiring without a real server or
// any shell-out. The disabled path short-circuits before runSensors(), so
// no I/O happens here. The fake is cast to Express at the call site.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj;
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

    const dbg = makeRes();
    await app.routes['/api/sensors/debug']({}, dbg);
    expect(dbg.body).toEqual({ disabled: true });
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
