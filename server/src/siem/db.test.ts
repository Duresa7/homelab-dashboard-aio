import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openSiemDb } from './db.js';
import type { InsertEventInput } from './types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-siemdb-test-'));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function evt(over: Partial<InsertEventInput> = {}): InsertEventInput {
  return {
    receivedAt: 1000,
    sourceIp: '198.51.100.1',
    severity: 6,
    message: 'hello',
    raw: 'raw hello',
    format: 'rfc3164',
    deviceKind: 'gateway',
    category: 'system',
    ...over,
  };
}

describe('siem store', () => {
  it('inserts, reads back by id, and normalizes camelCase + parsed extra', async () => {
    const db = await openSiemDb(path.join(tempDir, 'siem.sqlite'));
    const stored = await db.insertEvent(evt({ hostname: 'gw', extra: { rule: 'block' } }));
    expect(stored.id).toBeGreaterThan(0);

    const got = await db.getById(stored.id);
    expect(got).toMatchObject({
      id: stored.id,
      sourceIp: '198.51.100.1',
      hostname: 'gw',
      extra: { rule: 'block' },
    });
    await db.close();
  });

  it('filters queryEvents and treats a literal % as non-wildcard (ESCAPE)', async () => {
    const db = await openSiemDb(path.join(tempDir, 'siem.sqlite'));
    await db.insertEvent(
      evt({
        receivedAt: 100,
        severity: 3,
        category: 'firewall',
        sourceIp: '1.1.1.1',
        message: 'blocked 50% of traffic',
      }),
    );
    await db.insertEvent(
      evt({
        receivedAt: 200,
        severity: 6,
        category: 'system',
        sourceIp: '2.2.2.2',
        message: 'all ok',
      }),
    );

    expect((await db.queryEvents({ severity: '3' })).map((e) => e.sourceIp)).toEqual(['1.1.1.1']);
    expect((await db.queryEvents({ category: 'firewall' })).length).toBe(1);
    expect((await db.queryEvents({ sourceIp: '2.2.2.2' })).map((e) => e.severity)).toEqual([6]);
    expect((await db.queryEvents({ q: '50%' })).length).toBe(1);
    expect((await db.queryEvents({ q: 'no-such-text' })).length).toBe(0);
    expect((await db.queryEvents({})).map((e) => e.receivedAt)).toEqual([200, 100]);
    expect((await db.queryEvents({ order: 'asc' })).map((e) => e.receivedAt)).toEqual([100, 200]);
    await db.close();
  });

  it('aggregates stats and totals over a window', async () => {
    const db = await openSiemDb(path.join(tempDir, 'siem.sqlite'));
    const now = Date.now();
    await db.insertEvent(
      evt({
        receivedAt: now,
        severity: 3,
        category: 'firewall',
        deviceKind: 'gateway',
        sourceIp: '1.1.1.1',
      }),
    );
    await db.insertEvent(
      evt({
        receivedAt: now,
        severity: 3,
        category: 'firewall',
        deviceKind: 'ap',
        sourceIp: '1.1.1.1',
      }),
    );

    const stats = await db.getStats({ since: now - 1000 });
    expect(stats.bySeverity['3']).toBe(2);
    expect(stats.byCategory.firewall).toBe(2);
    expect(stats.byDeviceKind.gateway).toBe(1);
    expect(stats.bySource[0]).toEqual({ ip: '1.1.1.1', count: 2 });

    const totals = await db.totals();
    expect(totals.total).toBe(2);
    expect(totals.lastEventAt).toBe(now);
    await db.close();
  });

  it('purges old rows in chunks and replays after an id', async () => {
    const db = await openSiemDb(path.join(tempDir, 'siem.sqlite'));
    const first = await db.insertEvent(evt({ receivedAt: 100 }));
    await db.insertEvent(evt({ receivedAt: 5000 }));

    const removed = await db.purgeOlderThanChunk(1000, 10);
    expect(removed).toBe(1);
    expect((await db.totals()).total).toBe(1);

    const replay = await db.replayAfter(first.id);
    expect(replay.map((e) => e.receivedAt)).toEqual([5000]);
    await db.close();
  });

  it('reconciles a pre-versioning DB without re-running or losing data', async () => {
    const dbPath = path.join(tempDir, 'siem.sqlite');
    const raw = new Database(dbPath);
    raw
      .prepare(
        `CREATE TABLE syslog_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, log_time INTEGER,
          source_ip TEXT NOT NULL, hostname TEXT, facility INTEGER, severity INTEGER NOT NULL,
          tag TEXT, message TEXT NOT NULL, raw TEXT NOT NULL, format TEXT NOT NULL,
          device_kind TEXT NOT NULL, category TEXT NOT NULL, extra TEXT)`,
      )
      .run();
    raw
      .prepare(
        `INSERT INTO syslog_events
          (received_at, source_ip, severity, message, raw, format, device_kind, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(100, '9.9.9.9', 5, 'old event', 'old raw', 'rfc3164', 'gateway', 'system');
    raw.pragma('user_version = 1');
    raw.close();

    const db = await openSiemDb(dbPath);
    expect((await db.totals()).total).toBe(1);
    const got = await db.queryEvents({ sourceIp: '9.9.9.9' });
    expect(got[0]?.message).toBe('old event');
    await db.close();
  });
});
