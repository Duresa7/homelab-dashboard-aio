import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';

import { parseSyslog } from './parser.js';
import { classifySyslog } from './classifier.js';
import { openSiemDb } from './db.js';
import { createSseBus } from './sse.js';

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
// Cap a single UDP datagram so a misbehaving sender can't fill the DB or
// fan out 64KB JSON over SSE. RFC 5424 recommends ≥2048; we allow 8KB.
const MAX_PACKET_BYTES = 8 * 1024;
// Per-source rate limit. Each source IP gets a token bucket replenished at
// `RATE_PPS` packets/sec with a burst capacity of `RATE_BURST`. Above the
// rate we drop the packet and bump a counter for /api/siem/status.
const RATE_PPS = 200;
const RATE_BURST = 1000;
const RATE_BUCKETS_MAX = 4096; // cap distinct sources tracked
// Chunked retention sweep: each tick deletes one batch then yields to the
// event loop so HTTP/SSE/UDP handlers keep flowing.
const RETENTION_CHUNK_ROWS = 1000;

function bestLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.internal) continue;
      if (iface.family !== 'IPv4') continue;
      candidates.push(iface.address);
    }
  }
  // Skip docker/vEthernet IPs by preferring RFC1918 ranges.
  const priv = candidates.find(
    (ip) =>
      ip.startsWith('198.51.100.') || ip.startsWith('10.') || /^198.51.100.(1[6-9]|2\d|3[01])\./.test(ip),
  );
  return priv || candidates[0] || '127.0.0.1';
}

export async function initSiem(app, opts) {
  const {
    enabled,
    port = 514,
    host = '0.0.0.0',
    dbPath = path.resolve('data/siem.sqlite'),
    retentionDays = 30,
    maxPerQuery = 1000,
  } = opts;

  if (!enabled) {
    app.get('/api/siem/status', (_req, res) => {
      res.json({
        enabled: false,
        listening: false,
        host,
        port,
        serverAddress: bestLanIp(),
        eventsTotal: 0,
        eventsLastHour: 0,
        bytesReceived: 0,
        packetsReceived: 0,
        parseErrors: 0,
        lastEventAt: null,
        clientCount: 0,
        bindError: null,
      });
    });
    app.get('/api/siem/logs', (_req, res) => res.json({ disabled: true, events: [] }));
    app.get('/api/siem/stats', (_req, res) => res.json({ disabled: true }));
    app.get('/api/siem/stream', (_req, res) => res.status(503).end('SIEM disabled'));
    return { shutdown() {} };
  }

  const db = await openSiemDb(dbPath);
  const sse = createSseBus({ replayAfter: db.replayAfter });

  const stats = {
    packetsReceived: 0,
    bytesReceived: 0,
    parseErrors: 0,
    packetsTruncated: 0,
    packetsRateLimited: 0,
    lastEventAt: null,
    bindError: null,
    boundAt: null,
  };

  // Optional source-IP allowlist (comma-separated env var). Empty = allow all.
  const allowedSources = String(process.env.SIEM_ALLOWED_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sourceAllowSet = allowedSources.length ? new Set(allowedSources) : null;

  // Per-source token bucket. Map<ip, {tokens, lastRefillMs}>.
  const rateBuckets = new Map();
  function admit(ip) {
    const now = Date.now();
    let b = rateBuckets.get(ip);
    if (!b) {
      // Evict oldest if we're tracking too many sources (limits memory).
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

  const sock = dgram.createSocket('udp4');

  sock.on('message', (buf, rinfo) => {
    stats.packetsReceived += 1;
    stats.bytesReceived += buf.length;

    // Source allowlist check (env-configurable).
    if (sourceAllowSet && !sourceAllowSet.has(rinfo.address)) {
      stats.packetsRateLimited += 1;
      return;
    }
    // Per-source rate limiting.
    if (!admit(rinfo.address)) {
      stats.packetsRateLimited += 1;
      return;
    }

    // Truncate oversized packets so a single hostile sender can't fan out
    // 64KB SSE messages or fill the DB with megabyte rows.
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

    let stored;
    try {
      stored = db.insertEvent({
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
      console.warn(`SIEM: insert failed - ${err.message}`);
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
  });

  sock.on('error', (err) => {
    stats.bindError = err.message;
    console.warn(`SIEM: socket error - ${err.message}`);
  });

  sock.on('listening', () => {
    stats.boundAt = Date.now();
    const addr = sock.address();
    console.log(`SIEM: listening for syslog on UDP ${addr.address}:${addr.port}`);
  });

  await new Promise((resolve) => {
    sock.bind(port, host, () => resolve());
    sock.once('error', (err) => {
      stats.bindError = err.message;
      console.warn(
        `SIEM: failed to bind UDP ${host}:${port} - ${err.message}. ` +
          `On Windows, ports below 1024 may require an elevated terminal. ` +
          `Set SIEM_PORT=5514 in .env to use an unprivileged port, then point ` +
          `your UniFi controller at <server-ip>:5514.`,
      );
      resolve();
    });
  });

  let sweepRunning = false;
  async function sweep() {
    if (sweepRunning) return;
    if (!retentionDays || retentionDays <= 0) return;
    sweepRunning = true;
    const cutoff = Date.now() - retentionDays * 86400_000;
    let total = 0;
    try {
      // Loop until a chunk returns 0; yield to the event loop between
      // chunks so UDP, HTTP, and SSE handlers stay responsive.
      while (true) {
        const removed = db.purgeOlderThanChunk(cutoff, RETENTION_CHUNK_ROWS);
        total += removed;
        if (removed < RETENTION_CHUNK_ROWS) break;
        await new Promise((r) => setImmediate(r));
      }
      if (total > 0) {
        console.log(`SIEM: retention sweep removed ${total} events older than ${retentionDays}d`);
      }
    } catch (err) {
      console.warn(`SIEM: retention sweep failed - ${err.message}`);
    } finally {
      sweepRunning = false;
    }
  }
  void sweep();
  const sweepTimer = setInterval(() => {
    void sweep();
  }, RETENTION_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

  app.get('/api/siem/status', (_req, res) => {
    const t = db.totals();
    res.json({
      enabled: true,
      listening: !!stats.boundAt && !stats.bindError,
      host,
      port,
      serverAddress: bestLanIp(),
      eventsTotal: t.total,
      eventsLastHour: t.lastHour,
      bytesReceived: stats.bytesReceived,
      packetsReceived: stats.packetsReceived,
      packetsTruncated: stats.packetsTruncated,
      packetsRateLimited: stats.packetsRateLimited,
      parseErrors: stats.parseErrors,
      lastEventAt: t.lastEventAt,
      clientCount: sse.clientCount(),
      bindError: stats.bindError,
      retentionDays,
      maxPacketBytes: MAX_PACKET_BYTES,
      ratePps: RATE_PPS,
      rateBurst: RATE_BURST,
      sourceAllowlist: allowedSources,
    });
  });

  app.get('/api/siem/logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, maxPerQuery);
    const events = db.queryEvents({
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
  });

  app.get('/api/siem/stats', (req, res) => {
    const win = req.query.window || '1h';
    const map = {
      '15m': 900_000,
      '1h': 3600_000,
      '24h': 86400_000,
      '7d': 7 * 86400_000,
      '30d': 30 * 86400_000,
    };
    const ms = map[win] ?? 3600_000;
    res.json({ window: win, ...db.getStats({ since: Date.now() - ms }) });
  });

  app.get('/api/siem/stream', (req, res) => sse.handle(req, res));

  function shutdown() {
    clearInterval(sweepTimer);
    try {
      sock.close();
    } catch {
      /* ignore */
    }
    sse.shutdown();
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  return { shutdown };
}
