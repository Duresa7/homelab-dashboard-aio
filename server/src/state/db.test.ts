import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStateDb } from './db.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-statedb-test-'));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('state DB schema migrations', () => {
  it('stamps user_version on a fresh DB and re-open is idempotent', async () => {
    const dbPath = path.join(tempDir, 'state.sqlite');

    const db = await openStateDb(dbPath);
    expect((await db.stats()).schemaVersion).toBe(5);
    await db.put('tempUnit', 'f');
    await db.close();

    const reopened = await openStateDb(dbPath);
    expect((await reopened.stats()).schemaVersion).toBe(5);
    expect((await reopened.get('tempUnit'))?.value).toBe('f');
    await reopened.close();
  });

  it('cleans persisted inventory category copy while preserving item data', async () => {
    const dbPath = path.join(tempDir, 'state.sqlite');
    const legacyInventory = {
      lastUpdated: '2026-06-01',
      machines: [],
      components: [],
      spares: [
        {
          id: 'cat_net',
          name: 'Network',
          note: 'Active Ubiquiti gear powering the network.',
          columns: [{ id: 'model', label: 'Model' }],
          items: [
            {
              id: 's_ucg',
              deployment: 'in-service',
              values: { model: 'UCG-X (Example Gateway)' },
              ids: { uid: '0401' },
            },
          ],
        },
        {
          id: 'cat_legacy',
          name: 'Networking (legacy)',
          note: 'Earlier networking gear retained as spares.',
          columns: [{ id: 'model', label: 'Model' }],
          items: [
            {
              id: 's_netgear',
              deployment: 'spare',
              values: { brand: 'Netgear', model: 'GS308' },
              ids: { uid: '0402' },
            },
          ],
        },
      ],
    };

    const raw = new Database(dbPath);
    raw
      .prepare(
        `CREATE TABLE app_state (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      )
      .run();
    raw
      .prepare(`INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)`)
      .run('inventory', JSON.stringify(legacyInventory), 123);
    raw.pragma('user_version = 1');
    raw.close();

    const db = await openStateDb(dbPath);
    expect((await db.stats()).schemaVersion).toBe(5);
    const cleanedRow = await db.get('inventory');
    const cleaned = cleanedRow?.value as {
      devices: Array<{
        name: string;
        items: unknown[];
      }>;
    };

    expect(cleaned.devices.map((category) => category.name)).toEqual(['Network', 'Networking']);
    expect(cleaned.devices.every((category) => !('note' in category))).toBe(true);
    expect((cleaned as Record<string, unknown>).spares).toBeUndefined();
    expect(cleaned.devices[0].items).toEqual(legacyInventory.spares[0].items);
    expect(cleaned.devices[1].items).toEqual(legacyInventory.spares[1].items);
    expect(cleanedRow?.updatedAt).toBe(123);
    await db.close();

    const reopened = await openStateDb(dbPath);
    const reopenedRow = await reopened.get('inventory');
    expect(reopenedRow?.value).toEqual(cleaned);
    expect(reopenedRow?.updatedAt).toBe(123);
    await reopened.close();
  });
});
