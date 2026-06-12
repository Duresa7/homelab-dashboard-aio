import type { RemoteInfo } from 'node:dgram';

import { errorMessage } from '../lib/errors.js';
import type { SiemStore } from '../storage/types.js';
import { classifySyslog } from './classifier.js';
import { parseSyslog } from './parser.js';
import { isSourceAllowed, type SourceFilter } from './source-guard.js';
import type { StoredEvent, SyslogEvent } from './types.js';

export const DEFAULT_SIEM_PIPELINE_LIMITS = {
  maxPacketBytes: 8 * 1024,
  ratePps: 200,
  rateBurst: 1000,
  globalRatePps: Number(process.env.SIEM_GLOBAL_RATE_PPS) || 1000,
  globalRateBurst: Number(process.env.SIEM_GLOBAL_RATE_BURST) || 5000,
  rateBucketsMax: 4096,
} as const;

export interface SiemPipelineStats {
  packetsReceived: number;
  bytesReceived: number;
  parseErrors: number;
  packetsTruncated: number;
  packetsRateLimited: number;
  packetsBlocked: number;
  lastEventAt: number | null;
}

export interface SiemPipelineLimits {
  maxPacketBytes: number;
  ratePps: number;
  rateBurst: number;
  globalRatePps: number;
  globalRateBurst: number;
  rateBucketsMax: number;
}

export interface SiemPipelineOptions {
  store: Pick<SiemStore, 'insertEvent'>;
  sourceFilter: SourceFilter | null;
  onEvent: (event: SyslogEvent) => void;
  onInsertError?: (err: unknown) => void;
  now?: () => number;
  limits?: Partial<SiemPipelineLimits>;
}

function createStats(): SiemPipelineStats {
  return {
    packetsReceived: 0,
    bytesReceived: 0,
    parseErrors: 0,
    packetsTruncated: 0,
    packetsRateLimited: 0,
    packetsBlocked: 0,
    lastEventAt: null,
  };
}

function storedToEvent(stored: StoredEvent, extra: unknown): SyslogEvent {
  return {
    id: stored.id,
    receivedAt: stored.received_at,
    logTime: stored.log_time,
    sourceIp: stored.source_ip,
    hostname: stored.hostname,
    facility: stored.facility,
    severity: stored.severity,
    tag: stored.tag,
    message: stored.message,
    raw: stored.raw,
    format: stored.format,
    deviceKind: stored.device_kind,
    category: stored.category,
    extra: extra || null,
  };
}

export function createSiemPipeline(opts: SiemPipelineOptions) {
  const limits: SiemPipelineLimits = { ...DEFAULT_SIEM_PIPELINE_LIMITS, ...opts.limits };
  const now = opts.now ?? Date.now;
  let stats = createStats();

  const globalBucket = { tokens: limits.globalRateBurst, lastRefillMs: now() };
  const rateBuckets = new Map<string, { tokens: number; lastRefillMs: number }>();

  function admitGlobal(): boolean {
    const timestamp = now();
    const elapsed = timestamp - globalBucket.lastRefillMs;
    if (elapsed > 0) {
      globalBucket.tokens = Math.min(
        limits.globalRateBurst,
        globalBucket.tokens + (elapsed * limits.globalRatePps) / 1000,
      );
      globalBucket.lastRefillMs = timestamp;
    }
    if (globalBucket.tokens < 1) return false;
    globalBucket.tokens -= 1;
    return true;
  }

  function admitSource(ip: string): boolean {
    const timestamp = now();
    let bucket = rateBuckets.get(ip);
    if (!bucket) {
      if (rateBuckets.size >= limits.rateBucketsMax) {
        const firstKey = rateBuckets.keys().next().value;
        if (firstKey !== undefined) rateBuckets.delete(firstKey);
      }
      bucket = { tokens: limits.rateBurst, lastRefillMs: timestamp };
      rateBuckets.set(ip, bucket);
    } else {
      const elapsed = timestamp - bucket.lastRefillMs;
      if (elapsed > 0) {
        bucket.tokens = Math.min(
          limits.rateBurst,
          bucket.tokens + (elapsed * limits.ratePps) / 1000,
        );
        bucket.lastRefillMs = timestamp;
      }
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  async function ingest(buf: Buffer, rinfo: Pick<RemoteInfo, 'address'>): Promise<void> {
    stats.packetsReceived += 1;
    stats.bytesReceived += buf.length;

    if (!isSourceAllowed(opts.sourceFilter, rinfo.address)) {
      stats.packetsBlocked += 1;
      return;
    }

    if (!admitGlobal() || !admitSource(rinfo.address)) {
      stats.packetsRateLimited += 1;
      return;
    }

    let safeBuf = buf;
    if (buf.length > limits.maxPacketBytes) {
      safeBuf = buf.subarray(0, limits.maxPacketBytes);
      stats.packetsTruncated += 1;
    }

    const raw = safeBuf.toString('utf8');
    const parsed = parseSyslog(raw);
    if (!parsed) {
      stats.parseErrors += 1;
      return;
    }

    const tagged = classifySyslog(parsed, rinfo.address);
    const cefFields = parsed.cef?.fields;
    const extra = cefFields || (parsed.cef ? { _cef: parsed.cef } : null);

    let stored: StoredEvent;
    try {
      stored = await opts.store.insertEvent({
        receivedAt: now(),
        logTime: parsed.logTime ?? null,
        sourceIp: tagged.source_ip,
        hostname: parsed.hostname ?? null,
        facility: parsed.facility ?? null,
        severity: parsed.severity,
        tag: parsed.tag ?? null,
        message: parsed.message,
        raw,
        format: parsed.format,
        deviceKind: tagged.device_kind,
        category: tagged.category,
        extra,
      });
    } catch (err) {
      stats.parseErrors += 1;
      opts.onInsertError?.(err);
      if (!opts.onInsertError) console.warn(`SIEM: insert failed - ${errorMessage(err)}`);
      return;
    }

    stats.lastEventAt = stored.received_at;
    opts.onEvent(storedToEvent(stored, extra));
  }

  function snapshotStats(): SiemPipelineStats {
    return { ...stats };
  }

  function reset(): void {
    stats = createStats();
    globalBucket.tokens = limits.globalRateBurst;
    globalBucket.lastRefillMs = now();
    rateBuckets.clear();
  }

  return { ingest, stats: snapshotStats, reset, limits };
}
