import dgram from 'node:dgram';
import os from 'node:os';
import type { Express, Request, Response } from 'express';

import { errorMessage } from '../lib/errors.js';
import type { SiemStore } from '../storage/types.js';
import { createSseBus } from './sse.js';
import {
  createSiemPipeline,
  DEFAULT_SIEM_PIPELINE_LIMITS,
  type SiemPipelineStats,
} from './pipeline.js';
import { parseAllowedSources, resolveBindHost } from './source-guard.js';

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

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

  type SocketStats = {
    bindError: string | null;
    boundAt: number | null;
  };

  let socketStats = createSocketStats();

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

  function createSocketStats(): SocketStats {
    return {
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

  let pipeline = createSiemPipeline({
    store: db,
    sourceFilter,
    onEvent: (event) => sse.broadcast(event),
    onInsertError: (err) => console.warn(`SIEM: insert failed - ${errorMessage(err)}`),
  });

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
    await pipeline.ingest(buf, rinfo);
  }

  async function start() {
    if (!config.enabled || sock || closed) return;
    socketStats = createSocketStats();
    pipeline = createSiemPipeline({
      store: db,
      sourceFilter,
      onEvent: (event) => sse.broadcast(event),
      onInsertError: (err) => console.warn(`SIEM: insert failed - ${errorMessage(err)}`),
    });
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
      socketStats.bindError = err.message;
      console.warn(`SIEM: socket error - ${err.message}`);
    });

    nextSock.on('listening', () => {
      socketStats.boundAt = Date.now();
      const addr = nextSock.address();
      console.log(`SIEM: listening for syslog on UDP ${addr.address}:${addr.port}`);
    });

    await new Promise<void>((resolve) => {
      nextSock.bind(config.port, bind.host, () => resolve());
      nextSock.once('error', (err) => {
        socketStats.bindError = err.message;
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
    socketStats.boundAt = null;
  }

  const dbError = (res: Response, err: unknown) =>
    res.status(500).json({ error: err instanceof Error ? err.message : 'siem store error' });

  app.get('/api/siem/status', async (_req: Request, res: Response) => {
    if (!config.enabled) return res.json(disabledStatus());
    try {
      const t = await db.totals();
      const bind = effectiveBind();
      const stats: SiemPipelineStats = pipeline.stats();
      res.json({
        enabled: true,
        listening: !!socketStats.boundAt && !socketStats.bindError,
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
        bindError: socketStats.bindError,
        retentionDays: config.retentionDays,
        maxPacketBytes: DEFAULT_SIEM_PIPELINE_LIMITS.maxPacketBytes,
        ratePps: DEFAULT_SIEM_PIPELINE_LIMITS.ratePps,
        rateBurst: DEFAULT_SIEM_PIPELINE_LIMITS.rateBurst,
        globalRatePps: DEFAULT_SIEM_PIPELINE_LIMITS.globalRatePps,
        globalRateBurst: DEFAULT_SIEM_PIPELINE_LIMITS.globalRateBurst,
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
      listening: !!socketStats.boundAt && !socketStats.bindError,
      host: effectiveBind().host,
      port: config.port,
      bindError: socketStats.bindError,
    };
  }

  return { configure, shutdown, status };
}
