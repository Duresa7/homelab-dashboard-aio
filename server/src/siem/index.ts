import dgram from 'node:dgram';
import os from 'node:os';
import type { Express, Request, Response } from 'express';

import { errorMessage } from '../lib/errors.js';
import type { SiemStore } from '../storage/types.js';
import { parseSyslog } from './parser.js';
import { classifySyslog } from './classifier.js';
import type { StoredEvent } from './types.js';
import { createSseBus } from './sse.js';
import { isSourceAllowed, parseAllowedSources, resolveBindHost } from './source-guard.js';

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

const MAX_PACKET_BYTES = 8 * 1024;

const RATE_PPS = 200;
const RATE_BURST = 1000;
const GLOBAL_RATE_PPS = Number(process.env.SIEM_GLOBAL_RATE_PPS) || 1000;
const GLOBAL_RATE_BURST = Number(process.env.SIEM_GLOBAL_RATE_BURST) || 5000;
const RATE_BUCKETS_MAX = 4096;

const RETENTION_CHUNK_ROWS = 1000;

export interface SiemOptions {
  store: SiemStore;
  enabled: boolean;
  port?: number;
  host?: string;
  retentionDays?: number;
  maxPerQuery?: number;
}

export type SiemRuntimeConfig = Omit<SiemOptions, 'store'>;

export interface SiemStatus {
  enabled: boolean;
  configured: boolean;
  listening: boolean;
  host: string;
  port: number;
  bindError: string | null;
}

function bestLanIp(): string {
  const ifaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.internal) continue;
      if (iface.family !== 'IPv4') continue;
      candidates.push(iface.address);
    }
  }

  const priv = candidates.find(isPrivateIpv4);
  return priv || candidates[0] || '127.0.0.1';
}

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export async function initSiem(app: Express, opts: SiemOptions) {
  const db = opts.store;
  const sse = createSseBus({ replayAfter: db.replayAfter });

  let config = normalizeConfig(opts);
  let sock: dgram.Socket | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let sweepRunning = false;
  let closed = false;

  type SiemStats = {
    packetsReceived: number;
    bytesReceived: number;
    parseErrors: number;
    packetsTruncated: number;
    packetsRateLimited: number;
    packetsBlocked: number;
    lastEventAt: number | null;
    bindError: string | null;
    boundAt: number | null;
  };

  let stats = createStats();

  function normalizeConfig(next: SiemRuntimeConfig): Required<SiemRuntimeConfig> {
    const port = Number(next.port);
    const retentionDays = Number(next.retentionDays);
    const maxPerQuery = Number(next.maxPerQuery);
    return {
      enabled: Boolean(next.enabled),
      port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 514,
      host: next.host || '0.0.0.0',
      retentionDays: Number.isFinite(retentionDays) ? retentionDays : 30,
      maxPerQuery: Number.isFinite(maxPerQuery) && maxPerQuery > 0 ? maxPerQuery : 1000,
    };
  }

  function createStats(): SiemStats {
    return {
      packetsReceived: 0,
      bytesReceived: 0,
      parseErrors: 0,
      packetsTruncated: 0,
      packetsRateLimited: 0,
      packetsBlocked: 0,
      lastEventAt: null,
      bindError: null,
      boundAt: null,
    };
  }

  const sourceFilter = parseAllowedSources(process.env.SIEM_ALLOWED_SOURCES, (entry) =>
    console.warn(`SIEM: ignoring invalid SIEM_ALLOWED_SOURCES entry "${entry}"`),
  );
  const allowedSources = String(process.env.SIEM_ALLOWED_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const effectiveBind = () => resolveBindHost(config.host, sourceFilter);

  const globalBucket = { tokens: GLOBAL_RATE_BURST, lastRefillMs: Date.now() };
  function admitGlobal(): boolean {
    const now = Date.now();
    const elapsed = now - globalBucket.lastRefillMs;
    if (elapsed > 0) {
      globalBucket.tokens = Math.min(
        GLOBAL_RATE_BURST,
        globalBucket.tokens + (elapsed * GLOBAL_RATE_PPS) / 1000,
      );
      globalBucket.lastRefillMs = now;
    }
    if (globalBucket.tokens < 1) return false;
    globalBucket.tokens -= 1;
    return true;
  }

  const rateBuckets = new Map<string, { tokens: number; lastRefillMs: number }>();
  function admit(ip: string): boolean {
    const now = Date.now();
    let b = rateBuckets.get(ip);
    if (!b) {
      if (rateBuckets.size >= RATE_BUCKETS_MAX) {
        const firstKey = rateBuckets.keys().next().value;
        if (firstKey !== undefined) rateBuckets.delete(firstKey);
      }
      b = { tokens: RATE_BURST, lastRefillMs: now };
      rateBuckets.set(ip, b);
    } else {
      const elapsed = now - b.lastRefillMs;
      if (elapsed > 0) {
        b.tokens = Math.min(RATE_BURST, b.tokens + (elapsed * RATE_PPS) / 1000);
        b.lastRefillMs = now;
      }
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  function disabledStatus() {
    return {
      enabled: false,
      listening: false,
      host: config.host,
      port: config.port,
      serverAddress: bestLanIp(),
      eventsTotal: 0,
      eventsLastHour: 0,
      bytesReceived: 0,
      packetsReceived: 0,
      parseErrors: 0,
      lastEventAt: null,
      clientCount: 0,
      bindError: null,
    };
  }

  async function sweep() {
    if (sweepRunning) return;
    if (!config.retentionDays || config.retentionDays <= 0) return;
    sweepRunning = true;
    const cutoff = Date.now() - config.retentionDays * 86400_000;
    let total = 0;
    try {
      while (true) {
        const removed = await db.purgeOlderThanChunk(cutoff, RETENTION_CHUNK_ROWS);
        total += removed;
        if (removed < RETENTION_CHUNK_ROWS) break;
        await new Promise<void>((r) => setImmediate(() => r()));
      }
      if (total > 0) {
        console.log(
          `SIEM: retention sweep removed ${total} events older than ${config.retentionDays}d`,
        );
      }
    } catch (err) {
      console.warn(`SIEM: retention sweep failed - ${errorMessage(err)}`);
    } finally {
      sweepRunning = false;
    }
  }

  async function onMessage(buf: Buffer, rinfo: dgram.RemoteInfo) {
    stats.packetsReceived += 1;
    stats.bytesReceived += buf.length;

    if (!isSourceAllowed(sourceFilter, rinfo.address)) {
      stats.packetsBlocked += 1;
      return;
    }

    if (!admitGlobal()) {
      stats.packetsRateLimited += 1;
      return;
    }

    if (!admit(rinfo.address)) {
      stats.packetsRateLimited += 1;
      return;
    }

    let safeBuf = buf;
    if (buf.length > MAX_PACKET_BYTES) {
      safeBuf = buf.subarray(0, MAX_PACKET_BYTES);
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
      stored = await db.insertEvent({
        receivedAt: Date.now(),
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
      console.warn(`SIEM: insert failed - ${errorMessage(err)}`);
      return;
    }
    stats.lastEventAt = stored.received_at;

    sse.broadcast({
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
    });
  }

  async function start() {
    if (!config.enabled || sock || closed) return;
    stats = createStats();
    sweepRunning = false;

    const bind = effectiveBind();
    if (bind.loopbackFallback) {
      console.warn(
        `SIEM: SIEM_ALLOWED_SOURCES is not set, so binding loopback (127.0.0.1) instead of ` +
          `${config.host} to avoid accepting syslog from arbitrary hosts. Set ` +
          `SIEM_ALLOWED_SOURCES to a comma-separated list of sender IPs/CIDRs ` +
          `(e.g. "192.0.2.1,192.0.2.0/24") to listen on ${config.host}, or "*" to ` +
          `explicitly allow any source.`,
      );
    }

    const nextSock = dgram.createSocket('udp4');
    sock = nextSock;

    nextSock.on('message', onMessage);
    nextSock.on('error', (err) => {
      stats.bindError = err.message;
      console.warn(`SIEM: socket error - ${err.message}`);
    });

    nextSock.on('listening', () => {
      stats.boundAt = Date.now();
      const addr = nextSock.address();
      console.log(`SIEM: listening for syslog on UDP ${addr.address}:${addr.port}`);
    });

    await new Promise<void>((resolve) => {
      nextSock.bind(config.port, bind.host, () => resolve());
      nextSock.once('error', (err) => {
        stats.bindError = err.message;
        console.warn(
          `SIEM: failed to bind UDP ${bind.host}:${config.port} - ${err.message}. ` +
            `On Windows, ports below 1024 may require an elevated terminal. ` +
            `Set SIEM_PORT=5514 in .env to use an unprivileged port, then point ` +
            `your UniFi controller at <server-ip>:5514.`,
        );
        resolve();
      });
    });

    if (sock !== nextSock) {
      try {
        nextSock.close();
      } catch {
        void 0;
      }
      return;
    }

    void sweep();
    sweepTimer = setInterval(() => {
      void sweep();
    }, RETENTION_SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
  }

  function stop() {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    if (sock) {
      const oldSock = sock;
      sock = null;
      try {
        oldSock.close();
      } catch {
        void 0;
      }
    }
    sse.shutdown();
    stats.boundAt = null;
  }

  const dbError = (res: Response, err: unknown) =>
    res.status(500).json({ error: err instanceof Error ? err.message : 'siem store error' });

  app.get('/api/siem/status', async (_req: Request, res: Response) => {
    if (!config.enabled) return res.json(disabledStatus());
    try {
      const t = await db.totals();
      const bind = effectiveBind();
      res.json({
        enabled: true,
        listening: !!stats.boundAt && !stats.bindError,
        host: bind.host,
        port: config.port,
        loopbackOnly: bind.loopbackFallback,
        serverAddress: bestLanIp(),
        eventsTotal: t.total,
        eventsLastHour: t.lastHour,
        bytesReceived: stats.bytesReceived,
        packetsReceived: stats.packetsReceived,
        packetsTruncated: stats.packetsTruncated,
        packetsRateLimited: stats.packetsRateLimited,
        packetsBlocked: stats.packetsBlocked,
        parseErrors: stats.parseErrors,
        lastEventAt: t.lastEventAt,
        clientCount: sse.clientCount(),
        bindError: stats.bindError,
        retentionDays: config.retentionDays,
        maxPacketBytes: MAX_PACKET_BYTES,
        ratePps: RATE_PPS,
        rateBurst: RATE_BURST,
        globalRatePps: GLOBAL_RATE_PPS,
        globalRateBurst: GLOBAL_RATE_BURST,
        sourceAllowlist: allowedSources,
      });
    } catch (err) {
      dbError(res, err);
    }
  });

  app.get('/api/siem/logs', async (req: Request, res: Response) => {
    if (!config.enabled) return res.json({ disabled: true, events: [] });
    const limit = Math.min(Number(req.query.limit) || 200, config.maxPerQuery);
    try {
      const events = await db.queryEvents({
        since: req.query.since ? Number(req.query.since) : null,
        until: req.query.until ? Number(req.query.until) : null,
        severity: req.query.severity ?? null,
        deviceKind: req.query.device_kind ?? req.query.deviceKind ?? null,
        category: req.query.category ?? null,
        sourceIp: req.query.source_ip ?? req.query.sourceIp ?? null,
        q: req.query.q ?? null,
        afterId: req.query.after_id ? Number(req.query.after_id) : null,
        limit,
        order: req.query.order === 'asc' ? 'asc' : 'desc',
      });
      res.json({ events, limit });
    } catch (err) {
      dbError(res, err);
    }
  });

  app.get('/api/siem/stats', async (req: Request, res: Response) => {
    if (!config.enabled) return res.json({ disabled: true });
    const win = req.query.window || '1h';
    const map: Record<string, number> = {
      '15m': 900_000,
      '1h': 3600_000,
      '24h': 86400_000,
      '7d': 7 * 86400_000,
      '30d': 30 * 86400_000,
    };
    const ms = map[String(win)] ?? 3600_000;
    try {
      res.json({ window: win, ...(await db.getStats({ since: Date.now() - ms })) });
    } catch (err) {
      dbError(res, err);
    }
  });

  app.get('/api/siem/stream', (req: Request, res: Response) => {
    if (!config.enabled) return res.status(503).end('SIEM disabled');
    void sse.handle(req, res);
  });

  await start();

  function shutdown() {
    closed = true;
    stop();
    void db.close().catch(() => {
      void 0;
    });
  }

  async function configure(next: SiemRuntimeConfig) {
    if (closed) return;
    stop();
    config = normalizeConfig(next);
    await start();
  }

  function status(): SiemStatus {
    return {
      enabled: config.enabled,
      configured: config.enabled,
      listening: !!stats.boundAt && !stats.bindError,
      host: effectiveBind().host,
      port: config.port,
      bindError: stats.bindError,
    };
  }

  return { configure, shutdown, status };
}
