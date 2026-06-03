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
    expect((await db.stats()).schemaVersion).toBe(2);
    db.put('tempUnit', 'f');
    db.close();

    // Re-open: version is already at HEAD so the migration loop is a no-op,
    // and the previously-written row survives.
    const reopened = await openStateDb(dbPath);
    expect((await reopened.stats()).schemaVersion).toBe(2);
    expect(reopened.get('tempUnit')?.value).toBe('f');
    reopened.close();
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
              values: { model: 'UCG-Fiber (UniFi Cloud Gateway Fiber)' },
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
    expect((await db.stats()).schemaVersion).toBe(2);
    const cleaned = db.get('inventory')?.value as typeof legacyInventory;

    expect(cleaned.spares.map((category) => category.name)).toEqual(['Network', 'Networking']);
    expect(cleaned.spares.every((category) => !('note' in category))).toBe(true);
    expect(cleaned.spares[0].items).toEqual(legacyInventory.spares[0].items);
    expect(cleaned.spares[1].items).toEqual(legacyInventory.spares[1].items);
    expect(db.get('inventory')?.updatedAt).toBe(123);
    db.close();

    const reopened = await openStateDb(dbPath);
    expect(reopened.get('inventory')?.value).toEqual(cleaned);
    expect(reopened.get('inventory')?.updatedAt).toBe(123);
    reopened.close();
  });
});
