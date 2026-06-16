import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSecretKey, resetSecretKeyCache } from '../lib/secrets.js';
import type { StateEntry, StateSnapshot, StateStore, StateStoreStats } from '../storage/types.js';
import {
  createDeviceRegistry,
  type AmtDeviceDefaults,
  type DeviceRegistry,
} from './device-registry.js';

// Per-host behavior the fake WSMAN client reads, plus a record of the last
// connection so tests can assert the password was decrypted before dialing.
const hoisted = vi.hoisted(() => ({
  behaviors: new Map<string, { unreachable?: boolean; powerState?: string; amtVersion?: string }>(),
  lastConn: null as { host: string; password: string } | null,
}));

const DEFAULT_HW = {
  cpu: { model: 'Core i7', cores: 8, maxSpeedMhz: 3600 },
  memory: [
    {
      bankLabel: 'BANK 0',
      capacityBytes: 8 * 1024 ** 3,
      speedMhz: 3200,
      memoryType: 'DDR4',
      formFactor: 'DIMM',
    },
  ],
  bios: { vendor: 'Dell', version: '1.2.3', releaseDate: '2024-01-01' },
  nics: [{ mac: 'AA:BB:CC:DD:EE:FF', linkUp: true }],
};

vi.mock('./wsman.js', () => ({
  createAmtClient: (conn: { host: string; password: string }) => {
    hoisted.lastConn = { host: conn.host, password: conn.password };
    const b = hoisted.behaviors.get(conn.host) ?? {};
    const guard = () => {
      if (b.unreachable) throw new Error('connect ECONNREFUSED');
    };
    return {
      async getPowerState() {
        guard();
        return (b.powerState as 'on' | 'off' | 'sleep' | 'hibernate' | 'unknown') ?? 'on';
      },
      async requestPowerAction() {
        guard();
        return { returnValue: 0 };
      },
      async getHardwareInventory() {
        guard();
        return DEFAULT_HW;
      },
      async getGeneralSettings() {
        guard();
        return { hostname: conn.host, amtVersion: b.amtVersion ?? '15.0.0' };
      },
    };
  },
}));

// Imported after the mock so the provider closes over the fake createAmtClient.
const { amtProvider, registerAmtRoutes, clearAmtCache, configureAmt } = await import('./index.js');

/** Minimal in-memory StateStore (mirrors device-registry.test.ts). */
class MemoryStore implements StateStore {
  private values = new Map<string, unknown>();
  async getAll(): Promise<StateSnapshot> {
    return { values: Object.fromEntries(this.values), updatedAt: {} };
  }
  async get(key: string): Promise<StateEntry | null> {
    if (!this.values.has(key)) return null;
    return { value: this.values.get(key), updatedAt: 0 };
  }
  async put(key: string, value: unknown): Promise<number> {
    this.values.set(key, value);
    return 0;
  }
  async delete(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
  async importBulk(entries: Record<string, unknown>): Promise<number> {
    for (const [k, v] of Object.entries(entries)) this.values.set(k, v);
    return Object.keys(entries).length;
  }
  async stats(): Promise<StateStoreStats> {
    return { path: null, fileSize: null, keys: this.values.size, schemaVersion: 1 };
  }
  async close(): Promise<void> {}
}

const DEFAULTS: AmtDeviceDefaults = { port: 16993, username: 'admin', useTls: true };
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

let app: Express;
let store: MemoryStore;
let registry: DeviceRegistry;

beforeEach(async () => {
  hoisted.behaviors.clear();
  hoisted.lastConn = null;
  resetSecretKeyCache();
  configureAmt({ enabled: true, vendor: 'intel-amt', config: {} });
  clearAmtCache();

  const key = await getSecretKey();
  store = new MemoryStore();
  registry = createDeviceRegistry(store, key);
  app = express();
  registerAmtRoutes(app, registry);
});

describe('AMT provider fetch', () => {
  it('returns empty aggregate data when no devices are registered', async () => {
    clearAmtCache();
    const { amt } = await amtProvider.fetch!();
    expect(amt).toEqual({ devices: [], total: 0, online: 0, offline: 0, unreachable: 0 });
  });

  it('polls all devices in parallel and aggregates counts', async () => {
    await registry.upsert({ name: 'on', host: '10.0.0.1', password: 'pw' }, DEFAULTS);
    await registry.upsert({ name: 'off', host: '10.0.0.2', password: 'pw' }, DEFAULTS);
    await registry.upsert({ name: 'dead', host: '10.0.0.3', password: 'pw' }, DEFAULTS);
    hoisted.behaviors.set('10.0.0.1', { powerState: 'on' });
    hoisted.behaviors.set('10.0.0.2', { powerState: 'off' });
    hoisted.behaviors.set('10.0.0.3', { unreachable: true });
    clearAmtCache();

    const { amt } = await amtProvider.fetch!();
    expect(amt.total).toBe(3);
    expect(amt.online).toBe(1);
    expect(amt.offline).toBe(1);
    expect(amt.unreachable).toBe(1);

    const dead = amt.devices.find((d) => d.host === '10.0.0.3')!;
    expect(dead.reachable).toBe(false);
    expect(dead.error).toBeTruthy();
    expect(dead.lastSeenAt).toBeNull();
    expect(dead.hardware).toBeNull();

    const on = amt.devices.find((d) => d.host === '10.0.0.1')!;
    expect(on.reachable).toBe(true);
    expect(on.powerState).toBe('on');
    expect(on.lastSeenAt).not.toBeNull();
    expect(on.hardware?.cpu?.model).toBe('Core i7');
    expect(on.hardware?.cpu?.maxSpeedMHz).toBe(3600);
    expect(on.hardware?.memory?.totalMB).toBe(8192);
    expect(on.hardware?.nics?.[0]?.linkStatus).toBe('up');
    expect(on.hardware?.amtVersion).toBe('15.0.0');
  });

  it('rejects probe when no devices are configured', async () => {
    await expect(amtProvider.probe!(1000)).rejects.toThrow(/No AMT devices/);
  });
});

describe('AMT device CRUD routes', () => {
  it('lists devices with passwords redacted', async () => {
    const created = await registry.upsert(
      { name: 'rack', host: '10.0.0.5', password: 'sekret' },
      DEFAULTS,
    );
    const res = await request(app).get('/api/amt/devices').expect(200);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0].id).toBe(created.id);
    expect(res.body.devices[0].password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('sekret');
  });

  it('creates a device with defaults and redacts the password in the response', async () => {
    const res = await request(app)
      .post('/api/amt/devices')
      .send({ name: 'new', host: '10.0.0.6', password: 'pw' })
      .expect(201);
    expect(res.body.device.port).toBe(16993);
    expect(res.body.device.username).toBe('admin');
    expect(res.body.device.useTls).toBe(true);
    expect(res.body.device.password).toBeUndefined();
    expect(await registry.list()).toHaveLength(1);
  });

  it('rejects creates missing required fields with 400', async () => {
    await request(app)
      .post('/api/amt/devices')
      .send({ host: '10.0.0.6', password: 'pw' })
      .expect(400);
    await request(app).post('/api/amt/devices').send({ name: 'n', password: 'pw' }).expect(400);
    await request(app).post('/api/amt/devices').send({ name: 'n', host: '10.0.0.6' }).expect(400);
  });

  it('rejects creates pointing at a blocked host with 400', async () => {
    await request(app)
      .post('/api/amt/devices')
      .send({ name: 'meta', host: '169.254.169.254', password: 'pw' })
      .expect(400);
    expect(await registry.list()).toEqual([]);
  });

  it('updates a device in place, preserving its id', async () => {
    const created = await registry.upsert(
      { name: 'old', host: '10.0.0.7', password: 'pw' },
      DEFAULTS,
    );
    const res = await request(app)
      .put(`/api/amt/devices/${created.id}`)
      .send({ name: 'new', host: '10.0.0.8', password: 'pw2' })
      .expect(200);
    expect(res.body.device.id).toBe(created.id);
    expect(res.body.device.name).toBe('new');
    expect(res.body.device.host).toBe('10.0.0.8');
    expect(await registry.list()).toHaveLength(1);
  });

  it('rejects updates with an invalid id (400) or unknown id (404)', async () => {
    await request(app)
      .put('/api/amt/devices/not-a-uuid')
      .send({ name: 'n', host: '10.0.0.1', password: 'pw' })
      .expect(400);
    await request(app)
      .put(`/api/amt/devices/${FAKE_UUID}`)
      .send({ name: 'n', host: '10.0.0.1', password: 'pw' })
      .expect(404);
  });

  it('removes a device, returning 404 on a second delete and 400 for bad ids', async () => {
    const created = await registry.upsert(
      { name: 'gone', host: '10.0.0.9', password: 'pw' },
      DEFAULTS,
    );
    await request(app).delete(`/api/amt/devices/${created.id}`).expect(200, { ok: true });
    await request(app).delete(`/api/amt/devices/${created.id}`).expect(404);
    await request(app).delete('/api/amt/devices/bad').expect(400);
  });
});

describe('AMT power route', () => {
  it('executes a power action against the decrypted device credentials', async () => {
    const created = await registry.upsert(
      { name: 'p', host: '10.0.0.11', password: 'topsecret' },
      DEFAULTS,
    );
    hoisted.behaviors.set('10.0.0.11', { powerState: 'on' });
    const res = await request(app)
      .post('/api/amt/power')
      .send({ deviceId: created.id, action: 'cycle' })
      .expect(200);
    expect(res.body).toEqual({ ok: true, returnValue: 0 });
    expect(hoisted.lastConn?.password).toBe('topsecret');
  });

  it('validates the action and the device id', async () => {
    const created = await registry.upsert(
      { name: 'p', host: '10.0.0.12', password: 'pw' },
      DEFAULTS,
    );
    await request(app)
      .post('/api/amt/power')
      .send({ deviceId: created.id, action: 'explode' })
      .expect(400);
    await request(app).post('/api/amt/power').send({ deviceId: 'bad', action: 'on' }).expect(400);
    await request(app)
      .post('/api/amt/power')
      .send({ deviceId: FAKE_UUID, action: 'on' })
      .expect(404);
  });
});

describe('AMT inventory route', () => {
  it('returns mapped hardware inventory on demand', async () => {
    const created = await registry.upsert(
      { name: 'inv', host: '10.0.0.13', password: 'pw' },
      DEFAULTS,
    );
    hoisted.behaviors.set('10.0.0.13', {});
    const res = await request(app).get(`/api/amt/devices/${created.id}/inventory`).expect(200);
    expect(res.body.inventory.cpu.model).toBe('Core i7');
    expect(res.body.inventory.memory.totalMB).toBe(8192);
    expect(res.body.inventory.bios.vendor).toBe('Dell');
    expect(res.body.inventory.nics[0].linkStatus).toBe('up');
    expect(res.body.inventory.amtVersion).toBe('15.0.0');
  });

  it('rejects invalid ids (400) and unknown devices (404)', async () => {
    await request(app).get('/api/amt/devices/not-a-uuid/inventory').expect(400);
    await request(app).get(`/api/amt/devices/${FAKE_UUID}/inventory`).expect(404);
  });
});

describe('AMT routes without a registry', () => {
  it('returns 503 for every route when the registry is unavailable', async () => {
    const bare = express();
    registerAmtRoutes(bare, null);
    await request(bare).get('/api/amt/devices').expect(503);
    await request(bare).post('/api/amt/devices').send({}).expect(503);
  });
});
