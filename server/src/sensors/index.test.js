import { describe, it, expect } from 'vitest';
import { initSensors } from './index.js';

// Minimal Express stand-ins — capture registered route handlers and the
// response so we can exercise initSensors' wiring without a real server or
// any shell-out. The disabled path short-circuits before runSensors(), so
// no I/O happens here.
function makeApp() {
  const routes = {};
  return { routes, get(path, handler) { routes[path] = handler; } };
}
function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
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
    const handle = initSensors(app, DISABLED_CONFIG);
    expect(app.routes['/api/sensors']).toBeTypeOf('function');
    expect(app.routes['/api/sensors/debug']).toBeTypeOf('function');
    expect(handle.runSensors).toBeTypeOf('function');
    expect(handle.fetchSensorsData).toBeTypeOf('function');
  });

  it('short-circuits to {disabled:true} when the integration is off (no shell-out)', async () => {
    const app = makeApp();
    initSensors(app, DISABLED_CONFIG);

    const res = makeRes();
    await app.routes['/api/sensors']({}, res);
    expect(res.body).toEqual({ disabled: true });

    const dbg = makeRes();
    await app.routes['/api/sensors/debug']({}, dbg);
    expect(dbg.body).toEqual({ disabled: true });
  });

  it('returns 503 when SSH mode has no host configured', async () => {
    const app = makeApp();
    initSensors(app, { ...DISABLED_CONFIG, enabled: true, mode: 'ssh', sshHost: '' });

    const res = makeRes();
    await app.routes['/api/sensors']({}, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/no host configured/i);
  });
});
