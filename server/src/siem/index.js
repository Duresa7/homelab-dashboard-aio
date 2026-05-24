import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';

import { parseSyslog } from './parser.js';
import { classifySyslog } from './classifier.js';
import { openSiemDb } from './db.js';
import { createSseBus } from './sse.js';

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

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
  const priv = candidates.find((ip) =>
    ip.startsWith('198.51.100.') || ip.startsWith('10.') ||
    /^198.51.100.(1[6-9]|2\d|3[01])\./.test(ip),
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
        host, port,
        serverAddress: bestLanIp(),
        eventsTotal: 0, eventsLastHour: 0,
        bytesReceived: 0, packetsReceived: 0,
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
    lastEventAt: null,
    bindError: null,
    boundAt: null,
  };

  const sock = dgram.createSocket('udp4');

  sock.on('message', (buf, rinfo) => {
    stats.packetsReceived += 1;
    stats.bytesReceived += buf.length;
    const raw = buf.toString('utf8');
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

  function sweep() {
    if (!retentionDays || retentionDays <= 0) return;
    const cutoff = Date.now() - retentionDays * 86400_000;
    try {
      const removed = db.purgeOlderThan(cutoff);
      if (removed > 0) console.log(`SIEM: retention sweep removed ${removed} events older than ${retentionDays}d`);
    } catch (err) {
      console.warn(`SIEM: retention sweep failed - ${err.message}`);
    }
  }
  sweep();
  const sweepTimer = setInterval(sweep, RETENTION_SWEEP_INTERVAL_MS);
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
      parseErrors: stats.parseErrors,
      lastEventAt: t.lastEventAt,
      clientCount: sse.clientCount(),
      bindError: stats.bindError,
      retentionDays,
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
    const map = { '15m': 900_000, '1h': 3600_000, '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 };
    const ms = map[win] ?? 3600_000;
    res.json({ window: win, ...db.getStats({ since: Date.now() - ms }) });
  });

  app.get('/api/siem/stream', (req, res) => sse.handle(req, res));

  function shutdown() {
    clearInterval(sweepTimer);
    try { sock.close(); } catch { /* ignore */ }
    sse.shutdown();
    try { db.close(); } catch { /* ignore */ }
  }

  return { shutdown };
}
