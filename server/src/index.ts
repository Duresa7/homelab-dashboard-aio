import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initSiem } from './siem/index.js';
import { initState } from './state/index.js';
import { initSensors } from './sensors/index.js';
import { resolveDbConfig } from './storage/config.js';
import { openStores } from './storage/factory.js';
import { isEnabled } from './lib/env.js';
import { errorMessage } from './lib/errors.js';
import { registerDocker, dockerStatus, probeDocker } from './integrations/docker.js';
import { registerProxmox, proxmoxStatus, probeProxmox } from './integrations/proxmox.js';
import { registerUnas, unasStatus, probeUnas } from './integrations/unas.js';
import { registerUnifi, unifiStatus, probeUnifi } from './integrations/unifi.js';
import { registerGpu, gpuStatus, probeGpu } from './integrations/gpu.js';
import { registerWol, wolStatus } from './integrations/wol.js';
import {
  registerProtect,
  protectStatus,
  probeProtect,
  startProtect,
  shutdownProtect,
} from './integrations/protect.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Surface otherwise-invisible async failures. A promise rejection with no
// handler would otherwise vanish (or, on newer Node, terminate the process)
// with no log line explaining why. Skipped under test so it doesn't outlive
// the suite's module re-imports.
if (process.env.NODE_ENV !== 'test') {
  process.on('unhandledRejection', (reason) => {
    console.error(`Unhandled promise rejection: ${errorMessage(reason)}`);
  });
}

const SIEM_ENABLED = isEnabled(process.env.SIEM_ENABLED, false);
const SIEM_PORT = Number(process.env.SIEM_PORT) || 514;
const SIEM_HOST = process.env.SIEM_HOST || '0.0.0.0';
const SIEM_RETENTION_DAYS = Number(process.env.SIEM_RETENTION_DAYS) || 30;
const SIEM_MAX_PER_QUERY = Number(process.env.SIEM_MAX_PER_QUERY) || 1000;

// Resolve the database backend once at boot (SQLite at today's paths unless env
// or data/database.json selects otherwise). Used for both the store factory and
// the startup log.
const DB_CONFIG = resolveDbConfig();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    unifi: {
      enabled: unifiStatus.enabled,
      configured: unifiStatus.configured,
      hasKey: unifiStatus.hasKey,
    },
    portainer: {
      enabled: dockerStatus.enabled,
      configured: dockerStatus.configured,
    },
    proxmox: {
      enabled: proxmoxStatus.enabled,
      configured: proxmoxStatus.configured,
    },
    unas: {
      enabled: unasStatus.enabled,
      configured: unasStatus.configured,
    },
    protect: {
      enabled: protectStatus.enabled,
      configured: protectStatus.configured,
    },
    gpu: {
      enabled: gpuStatus.enabled,
      configured: gpuStatus.configured,
    },
    wol: {
      enabled: wolStatus.enabled,
      configured: wolStatus.configured,
    },
    sensors: {
      enabled: SENSORS_ENABLED,
      configured: SENSORS_MODE === 'local' || !!SENSORS_SSH_HOST,
    },
  });
});

const LIVE_HEALTH_CACHE_TTL_MS = Number(process.env.HEALTH_LIVE_CACHE_TTL) || 12000;
const LIVE_HEALTH_PROBE_TIMEOUT_MS = Number(process.env.HEALTH_LIVE_TIMEOUT) || 5000;

interface ProbeResult {
  name: string;
  status: 'ok' | 'down' | 'skipped';
  ok: boolean | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

interface LiveHealth {
  ok: boolean;
  checkedAt: string;
  summary: { total: number; ok: number; down: number; skipped: number };
  integrations: Record<string, ProbeResult>;
}

let liveHealthCache: { data: LiveHealth | null; ts: number } = { data: null, ts: 0 };

async function runProbe(
  name: string,
  configured: boolean,
  fn: () => unknown,
): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString();
  if (!configured) {
    return {
      name,
      status: 'skipped',
      ok: null,
      latencyMs: null,
      error: null,
      checkedAt,
    };
  }
  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeoutP = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(new Error(`probe timed out after ${LIVE_HEALTH_PROBE_TIMEOUT_MS}ms`)),
      LIVE_HEALTH_PROBE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([Promise.resolve().then(fn), timeoutP]);
    return {
      name,
      status: 'ok',
      ok: true,
      latencyMs: Date.now() - start,
      error: null,
      checkedAt,
    };
  } catch (err) {
    const msg = errorMessage(err);
    return {
      name,
      status: 'down',
      ok: false,
      latencyMs: Date.now() - start,
      error: msg.slice(0, 300),
      checkedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

app.get('/api/health/live', async (req, res) => {
  const force = req.query.refresh === '1' || req.query.force === '1';
  const now = Date.now();
  if (!force && liveHealthCache.data && now - liveHealthCache.ts < LIVE_HEALTH_CACHE_TTL_MS) {
    res.set('Cache-Control', 'no-store');
    return res.json({
      ...liveHealthCache.data,
      fromCache: true,
      ageMs: now - liveHealthCache.ts,
      cacheTtlMs: LIVE_HEALTH_CACHE_TTL_MS,
    });
  }

  const probes = await Promise.all([
    runProbe('unifi', unifiStatus.enabled && !!unifiStatus.baseUrl && unifiStatus.configured, () =>
      probeUnifi(),
    ),
    runProbe('portainer', dockerStatus.enabled && dockerStatus.configured, () =>
      probeDocker(LIVE_HEALTH_PROBE_TIMEOUT_MS),
    ),
    runProbe('proxmox', proxmoxStatus.enabled && proxmoxStatus.configured, () => probeProxmox()),
    runProbe('unas', unasStatus.enabled && unasStatus.configured, () => probeUnas()),
    runProbe('protect', protectStatus.enabled && protectStatus.configured, () => probeProtect()),
    runProbe('gpu', gpuStatus.enabled && gpuStatus.configured, () => probeGpu()),
    runProbe('sensors', SENSORS_ENABLED && (SENSORS_MODE === 'local' || !!SENSORS_SSH_HOST), () =>
      sensorsHandle.runSensors(),
    ),
  ]);

  const byKey: Record<string, ProbeResult> = {};
  for (const p of probes) byKey[p.name] = p;

  const summary = {
    total: probes.length,
    ok: probes.filter((p) => p.status === 'ok').length,
    down: probes.filter((p) => p.status === 'down').length,
    skipped: probes.filter((p) => p.status === 'skipped').length,
  };

  const result: LiveHealth = {
    ok: summary.down === 0,
    checkedAt: new Date().toISOString(),
    summary,
    integrations: byKey,
  };
  liveHealthCache = { data: result, ts: now };
  res.set('Cache-Control', 'no-store');
  res.json({ ...result, fromCache: false, ageMs: 0, cacheTtlMs: LIVE_HEALTH_CACHE_TTL_MS });
});

registerUnifi(app);
registerDocker(app);

registerProxmox(app);
registerGpu(app);
registerWol(app);

// Sensors share the GPU SSH config by default — both usually target the same host.

const SENSORS_ENABLED = isEnabled(process.env.SENSORS_ENABLED);
const SENSORS_MODE = (process.env.SENSORS_MODE || gpuStatus.mode).toLowerCase();
const SENSORS_SSH_HOST = process.env.SENSORS_SSH_HOST || gpuStatus.host;
const SENSORS_SSH_USER = process.env.SENSORS_SSH_USER || gpuStatus.user;
const SENSORS_SSH_PORT = Number(process.env.SENSORS_SSH_PORT) || gpuStatus.port;
const SENSORS_SSH_KEY_PATH = process.env.SENSORS_SSH_KEY_PATH || gpuStatus.keyPath;
const SENSORS_CACHE_TTL = Number(process.env.SENSORS_POLL_INTERVAL) || 5000;

const sensorsHandle = initSensors(app, {
  enabled: SENSORS_ENABLED,
  mode: SENSORS_MODE,
  sshHost: SENSORS_SSH_HOST,
  sshUser: SENSORS_SSH_USER,
  sshPort: SENSORS_SSH_PORT,
  sshKeyPath: SENSORS_SSH_KEY_PATH,
  cacheTtl: SENSORS_CACHE_TTL,
});

registerUnas(app);
registerProtect(app);

// Protect owns long-lived resources (WS subscriber + ffmpeg sessions); tear them
// down on shutdown. Registered before the state/SIEM handlers to preserve the
// original ordering.
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGINT', () => {
    shutdownProtect();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdownProtect();
    process.exit(0);
  });
  process.on('exit', shutdownProtect);
}

// Open both stores for the resolved backend (SQLite at today's paths by
// default). DB selection is read from env/file at boot since the app config
// store lives inside the chosen DB.
const stores = await openStores(DB_CONFIG).catch((err) => {
  console.error(`Database: failed to open stores - ${errorMessage(err)}`);
  return null;
});

// Persistent app-state DB (inventory, thresholds, tweaks, etc.). Core, always on.
const stateHandle = stores
  ? await initState(app, { store: stores.state }).catch((err) => {
      console.error(`State: init failed - ${err.message}`);
      return { shutdown() {} };
    })
  : { shutdown() {} };
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGINT', () => {
    try {
      stateHandle.shutdown();
    } catch {
      /* ignore */
    }
  });
  process.on('SIGTERM', () => {
    try {
      stateHandle.shutdown();
    } catch {
      /* ignore */
    }
  });
}

// SIEM mounts UDP listener + SSE + REST routes on `app`. Must complete before app.listen.
const siemHandle = stores
  ? await initSiem(app, {
      store: stores.siem,
      enabled: SIEM_ENABLED,
      port: SIEM_PORT,
      host: SIEM_HOST,
      retentionDays: SIEM_RETENTION_DAYS,
      maxPerQuery: SIEM_MAX_PER_QUERY,
    }).catch((err) => {
      console.error(`SIEM: init failed - ${err.message}`);
      return { shutdown() {} };
    })
  : { shutdown() {} };
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGINT', () => {
    try {
      siemHandle.shutdown();
    } catch {
      /* ignore */
    }
  });
  process.on('SIGTERM', () => {
    try {
      siemHandle.shutdown();
    } catch {
      /* ignore */
    }
  });
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Static SPA + fallback so client-side routes resolve on hard refresh.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
app.use(express.static(distDir, { index: false, maxAge: '1h' }));
app.get(/^\/(?!api\/|healthz).*/, (_req, res, next) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => err && next());
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dashboard listening on http://0.0.0.0:${PORT}`);
    if (unifiStatus.enabled) {
      console.log(`UniFi: enabled — ${unifiStatus.baseUrl}`);
      console.log(
        `UniFi API Key: ${unifiStatus.hasKey ? 'configured' : 'NO — add UNIFI_API_KEY to .env'}`,
      );
    } else {
      console.log('UniFi: DISABLED (set UNIFI_ENABLED=true in .env to enable)');
    }
    if (proxmoxStatus.enabled) {
      console.log(
        `Proxmox: ${proxmoxStatus.configured ? `enabled — ${proxmoxStatus.baseUrl}` : 'enabled but NOT configured — set PROXMOX_* in .env'}`,
      );
    } else {
      console.log('Proxmox: DISABLED (set PROXMOX_ENABLED=true in .env to enable)');
    }
    if (dockerStatus.enabled) {
      console.log(
        `Portainer: ${dockerStatus.configured ? `enabled — ${dockerStatus.baseUrl}` : 'enabled but NOT configured — set PORTAINER_* in .env'}`,
      );
    } else {
      console.log('Portainer: DISABLED (set PORTAINER_ENABLED=true in .env to enable)');
    }
    if (unasStatus.enabled) {
      console.log(
        `UNAS: ${unasStatus.configured ? `enabled — ${unasStatus.baseUrl}` : 'enabled but NOT configured — set UNAS_* in .env'}`,
      );
    } else {
      console.log('UNAS: DISABLED (set UNAS_ENABLED=true in .env to enable)');
    }
    if (protectStatus.enabled) {
      console.log(
        `Protect: ${protectStatus.configured ? `enabled — ${protectStatus.baseUrl}` : 'enabled but NOT configured — set PROTECT_* in .env'}`,
      );
      startProtect();
    } else {
      console.log('Protect: DISABLED (set PROTECT_ENABLED=true in .env to enable)');
    }
    if (gpuStatus.enabled) {
      if (gpuStatus.mode === 'local') {
        console.log('GPU: enabled — local nvidia-smi');
      } else if (gpuStatus.host) {
        console.log(`GPU: enabled — ssh ${gpuStatus.user}@${gpuStatus.host}:${gpuStatus.port}`);
      } else {
        console.log('GPU: enabled but NOT configured — set GPU_SSH_HOST or GPU_MODE=local in .env');
      }
    } else {
      console.log('GPU: DISABLED (set GPU_ENABLED=true in .env to enable)');
    }
    if (SENSORS_ENABLED) {
      if (SENSORS_MODE === 'local') {
        console.log('Sensors: enabled — local sensors -j');
      } else if (SENSORS_SSH_HOST) {
        console.log(
          `Sensors: enabled — ssh ${SENSORS_SSH_USER}@${SENSORS_SSH_HOST}:${SENSORS_SSH_PORT}`,
        );
      } else {
        console.log(
          'Sensors: enabled but NOT configured — set SENSORS_SSH_HOST/GPU_SSH_HOST or SENSORS_MODE=local in .env',
        );
      }
    } else {
      console.log('Sensors: DISABLED (set SENSORS_ENABLED=true in .env to enable)');
    }
    if (wolStatus.enabled) {
      console.log('Wake-on-LAN: enabled');
    } else {
      console.log('Wake-on-LAN: DISABLED (set WOL_ENABLED=true in .env to enable)');
    }
    if (SIEM_ENABLED) {
      console.log(
        `SIEM: enabled — UDP ${SIEM_HOST}:${SIEM_PORT}, db ${DB_CONFIG.sqlite.siemPath}, retention ${SIEM_RETENTION_DAYS}d`,
      );
    } else {
      console.log(
        'SIEM: DISABLED (set SIEM_ENABLED=true in .env to enable syslog ingestion on UDP 514)',
      );
    }
    console.log(`State: db ${DB_CONFIG.sqlite.statePath}`);
  });
}

export { app, sensorsHandle, shutdownProtect, siemHandle, stateHandle };
