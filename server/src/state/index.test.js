import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initState } from './index.js';

let tempDir;
let stateHandle;
let api;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-state-test-'));
  const app = express();
  stateHandle = await initState(app, { dbPath: path.join(tempDir, 'state.sqlite') });
  api = request(app);
});

afterEach(async () => {
  stateHandle?.shutdown();
  await rm(tempDir, { recursive: true, force: true });
});

describe('state API contract', () => {
  it('stores, reads, and deletes valid keys', async () => {
    await api.put('/api/state/route').send({ section: 'overview' }).expect(200);

    const read = await api.get('/api/state/route').expect(200);
    expect(read.body.value).toEqual({ section: 'overview' });
    expect(read.body.updatedAt).toEqual(expect.any(Number));

    await api.delete('/api/state/route').expect(200, { key: 'route', removed: 1 });
    await api.get('/api/state/route').expect(404);
  });

  it('rejects invalid keys and null bodies', async () => {
    await api.put('/api/state/bad key').send({ ok: true }).expect(400);
    await api
      .put('/api/state/route')
      .set('Content-Type', 'application/json')
      .send('null')
      .expect(400, { error: 'invalid JSON body' });
  });

  it('filters bulk imports to valid key and body pairs', async () => {
    const res = await api
      .post('/api/state/_import')
      .send({
        inventory: { machines: [] },
        'bad key': { ignored: true },
        route: null,
        'custom.value': 42,
      })
      .expect(200);

    expect(res.body.imported).toBe(2);
    expect(res.body.keys.sort()).toEqual(['custom.value', 'inventory']);

    const all = await api.get('/api/state').expect(200);
    expect(all.body.values).toEqual({
      inventory: { machines: [] },
      'custom.value': 42,
    });
  });

  it('enforces same-origin writes for browser-originated requests', async () => {
    await api
      .put('/api/state/tempUnit')
      .set('Host', 'dashboard.test')
      .set('Origin', 'http://evil.test')
      .send('f')
      .expect(403, { error: 'cross-origin write rejected' });

    await api
      .put('/api/state/tempUnit')
      .set('Host', 'dashboard.test')
      .set('Origin', 'http://dashboard.test')
      .send('f')
      .expect(200);
  });

  // Regression: top-level JSON primitives (e.g. tempUnit "f", a boolean toggle,
  // a numeric count) must be accepted AND persisted with their type. Express's
  // default `express.json({ strict: true })` rejects primitives outright, which
  // would silently break persistence of these reserved/primitive keys; the
  // route uses `strict: false` precisely so they round-trip.
  it('round-trips primitive values that strict JSON parsing would reject', async () => {
    const putJson = (key, raw) =>
      api.put(`/api/state/${key}`).set('Content-Type', 'application/json').send(raw).expect(200);

    await putJson('tempUnit', '"f"');
    await putJson('sidebarCollapsed', 'true');
    await putJson('custom.count', '42');

    expect((await api.get('/api/state/tempUnit').expect(200)).body.value).toBe('f');
    expect((await api.get('/api/state/sidebarCollapsed').expect(200)).body.value).toBe(true);
    expect((await api.get('/api/state/custom.count').expect(200)).body.value).toBe(42);
  });
});
