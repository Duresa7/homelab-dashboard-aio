import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { decryptSecret, isEncryptedValue } from '../lib/secrets.js';
import type { StateEntry, StateSnapshot, StateStore, StateStoreStats } from '../storage/types.js';
import {
  AMT_DEVICES_KEY,
  createDeviceRegistry,
  type AmtDeviceDefaults,
  type DeviceRegistry,
} from './device-registry.js';

/** Minimal in-memory StateStore for the bits the registry touches. */
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

  /** Test helper: read the raw stored blob. */
  raw(key: string): unknown {
    return this.values.get(key);
  }
}

const DEFAULTS: AmtDeviceDefaults = { port: 16993, username: 'admin', useTls: true };
const KEY = randomBytes(32);

let store: MemoryStore;
let registry: DeviceRegistry;

beforeEach(() => {
  store = new MemoryStore();
  registry = createDeviceRegistry(store, KEY);
});

describe('AMT device registry', () => {
  it('starts empty and returns null for unknown ids', async () => {
    expect(await registry.list()).toEqual([]);
    expect(await registry.get('nope')).toBeNull();
  });

  it('creates a device, applying defaults and encrypting the password', async () => {
    const device = await registry.upsert(
      { name: 'rack-01', host: '192.0.2.50', password: 's3cret' },
      DEFAULTS,
    );

    expect(device.id).toMatch(/[0-9a-f-]{36}/);
    expect(device.name).toBe('rack-01');
    expect(device.host).toBe('192.0.2.50');
    expect(device.port).toBe(DEFAULTS.port);
    expect(device.username).toBe(DEFAULTS.username);
    expect(device.useTls).toBe(DEFAULTS.useTls);

    expect(isEncryptedValue(device.password)).toBe(true);
    expect(JSON.stringify(device.password)).not.toContain('s3cret');
    expect(decryptSecret(device.password, KEY)).toBe('s3cret');

    expect(await registry.list()).toHaveLength(1);
    expect(await registry.get(device.id)).toEqual(device);
  });

  it('honors explicit field overrides over defaults', async () => {
    const device = await registry.upsert(
      {
        name: 'plain',
        host: 'amt.lan',
        password: 'pw',
        port: 16992,
        username: 'operator',
        useTls: false,
      },
      DEFAULTS,
    );

    expect(device.port).toBe(16992);
    expect(device.username).toBe('operator');
    expect(device.useTls).toBe(false);
  });

  it('updates an existing device in place, preserving its id', async () => {
    const created = await registry.upsert(
      { name: 'old', host: '192.0.2.10', password: 'pw1' },
      DEFAULTS,
    );

    const updated = await registry.upsert(
      { id: created.id, name: 'new', host: '192.0.2.11', password: 'pw2' },
      DEFAULTS,
    );

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('new');
    expect(updated.host).toBe('192.0.2.11');
    expect(decryptSecret(updated.password, KEY)).toBe('pw2');

    expect(await registry.list()).toHaveLength(1);
  });

  it('persists devices as a JSON array under amt.devices', async () => {
    await registry.upsert({ name: 'a', host: '10.0.0.5', password: 'pw' }, DEFAULTS);
    const blob = store.raw(AMT_DEVICES_KEY);
    expect(Array.isArray(blob)).toBe(true);
    expect((blob as unknown[]).length).toBe(1);
  });

  it('rejects blocked hosts (link-local / metadata) via the SSRF guard', async () => {
    await expect(
      registry.upsert({ name: 'meta', host: '169.254.169.254', password: 'pw' }, DEFAULTS),
    ).rejects.toThrow();
    expect(await registry.list()).toEqual([]);
  });

  it('removes a device and returns true', async () => {
    const device = await registry.upsert(
      { name: 'gone', host: '192.0.2.20', password: 'pw' },
      DEFAULTS,
    );
    expect(await registry.remove(device.id)).toBe(true);
    expect(await registry.list()).toEqual([]);
  });

  it('returns false when removing a nonexistent id without throwing', async () => {
    await expect(registry.remove('missing')).resolves.toBe(false);
  });
});
