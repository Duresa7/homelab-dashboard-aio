import { describe, expect, it, vi } from 'vitest';

import { parseAllowedSources } from './source-guard.js';
import { createSiemPipeline } from './pipeline.js';
import type { InsertEventInput, StoredEvent, SyslogEvent } from './types.js';

function validPacket(message = 'Accepted password for root'): Buffer {
  return Buffer.from(`<13>Jun 12 13:45:00 UCG-X sshd[42]: ${message}`);
}

function storedFromInput(input: InsertEventInput, id: number): StoredEvent {
  return {
    id,
    received_at: input.receivedAt,
    log_time: input.logTime ?? null,
    source_ip: input.sourceIp,
    hostname: input.hostname ?? null,
    facility: input.facility ?? null,
    severity: input.severity,
    tag: input.tag ?? null,
    message: input.message,
    raw: input.raw,
    format: input.format,
    device_kind: input.deviceKind,
    category: input.category,
    extra: input.extra ? JSON.stringify(input.extra) : null,
  };
}

function storeFixture() {
  const inserts: InsertEventInput[] = [];
  return {
    inserts,
    store: {
      insertEvent: vi.fn(async (input: InsertEventInput) => {
        inserts.push(input);
        return storedFromInput(input, inserts.length);
      }),
    },
  };
}

describe('SIEM ingest pipeline', () => {
  it('stores and broadcasts parsed syslog packets', async () => {
    const { store, inserts } = storeFixture();
    const onEvent = vi.fn<(event: SyslogEvent) => void>();
    const pipeline = createSiemPipeline({
      store,
      sourceFilter: null,
      onEvent,
      now: () => 1_000,
    });

    await pipeline.ingest(validPacket(), { address: '192.0.2.10' });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      receivedAt: 1_000,
      sourceIp: '192.0.2.10',
      hostname: 'UCG-X',
      severity: 5,
      tag: 'sshd',
      message: 'Accepted password for root',
      deviceKind: 'gateway',
      category: 'admin',
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        receivedAt: 1_000,
        sourceIp: '192.0.2.10',
        category: 'admin',
      }),
    );
    expect(pipeline.stats()).toMatchObject({
      packetsReceived: 1,
      parseErrors: 0,
      insertErrors: 0,
      lastEventAt: 1_000,
    });
  });

  it('blocks packets from sources outside the allowlist', async () => {
    const { store } = storeFixture();
    const pipeline = createSiemPipeline({
      store,
      sourceFilter: parseAllowedSources('198.51.100.10'),
      onEvent: vi.fn(),
    });

    await pipeline.ingest(validPacket(), { address: '192.0.2.10' });

    expect(store.insertEvent).not.toHaveBeenCalled();
    expect(pipeline.stats()).toMatchObject({
      packetsReceived: 1,
      packetsBlocked: 1,
    });
  });

  it('rate-limits packets by source IP', async () => {
    const { store } = storeFixture();
    const pipeline = createSiemPipeline({
      store,
      sourceFilter: null,
      onEvent: vi.fn(),
      now: () => 1_000,
      limits: {
        rateBurst: 1,
        ratePps: 0,
        globalRateBurst: 10,
        globalRatePps: 0,
      },
    });

    await pipeline.ingest(validPacket('first'), { address: '192.0.2.10' });
    await pipeline.ingest(validPacket('second'), { address: '192.0.2.10' });

    expect(store.insertEvent).toHaveBeenCalledTimes(1);
    expect(pipeline.stats()).toMatchObject({
      packetsReceived: 2,
      packetsRateLimited: 1,
    });
  });

  it('counts insert failures without broadcasting an event', async () => {
    const onInsertError = vi.fn();
    const onEvent = vi.fn();
    const store = {
      insertEvent: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    };
    const pipeline = createSiemPipeline({
      store,
      sourceFilter: null,
      onEvent,
      onInsertError,
    });

    await pipeline.ingest(validPacket(), { address: '192.0.2.10' });

    expect(onInsertError).toHaveBeenCalledWith(expect.any(Error));
    expect(onEvent).not.toHaveBeenCalled();
    expect(pipeline.stats()).toMatchObject({
      parseErrors: 0,
      insertErrors: 1,
      lastEventAt: null,
    });
  });
});
