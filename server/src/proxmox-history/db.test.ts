import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProxmoxHistoryStore } from './db.js';

let tempDir = '';

describe('proxmox history store', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-proxmox-history-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes, prunes, and bucket-averages bounded series', () => {
    const store = new ProxmoxHistoryStore(path.join(tempDir, 'history.sqlite'));
    try {
      expect(
        store.insertSamples([
          {
            ts: 0,
            entityType: 'node',
            entityId: 'pve1',
            node: 'pve1',
            metric: 'cpu_pct',
            value: 10,
          },
          {
            ts: 10,
            entityType: 'node',
            entityId: 'pve1',
            node: 'pve1',
            metric: 'cpu_pct',
            value: 30,
          },
          {
            ts: 70,
            entityType: 'node',
            entityId: 'pve1',
            node: 'pve1',
            metric: 'cpu_pct',
            value: 90,
          },
        ]),
      ).toBe(3);

      expect(
        store.querySeries({
          entityType: 'node',
          entityId: 'pve1',
          metric: 'cpu_pct',
          from: 0,
          to: 100,
          points: 2,
        }),
      ).toEqual([
        { t: 0, v: 20 },
        { t: 70, v: 90 },
      ]);

      expect(store.pruneOlderThan(50)).toBe(2);
      expect(
        store.querySeries({
          entityType: 'node',
          entityId: 'pve1',
          metric: 'cpu_pct',
          from: 0,
          to: 100,
          points: 10,
        }),
      ).toEqual([{ t: 70, v: 90 }]);
    } finally {
      store.close();
    }
  });
});
