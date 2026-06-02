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
});
