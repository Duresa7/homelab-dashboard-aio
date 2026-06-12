import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initAuth, type AuthHandle } from './auth/index.js';
import { createUnavailableGate } from './auth/middleware.js';
import { initImages } from './images/index.js';
import { initSiem, type SiemRuntimeConfig } from './siem/index.js';
import { initProxmoxHistory } from './proxmox-history/index.js';
import { initState } from './state/index.js';
import { initSensors } from './sensors/index.js';
import { initSetup } from './setup/index.js';
import {
  importEnvConfigIfEmpty,
  readIntegrationConfig,
  type IntegrationConfig,
  type Selection,
} from './setup/integration-config.js';
import { resolveDbConfig } from './storage/config.js';
import { openStores } from './storage/factory.js';
import { isEnabled } from './lib/env.js';
import { errorMessage } from './lib/errors.js';
import { dockerStatus } from './integrations/docker.js';
import { proxmoxStatus, registerProxmoxNodeRoutes } from './integrations/proxmox.js';
import { unasStatus } from './integrations/unas.js';
import { unifiStatus } from './integrations/unifi.js';
import { gpuStatus } from './integrations/gpu.js';
import { registerWol, wolStatus } from './integrations/wol.js';
import { createProviderCatalog, type ProviderCatalog } from './integrations/registry.js';
import {
  readProviderStatus,
  registerProvider,
  type RuntimeProvider,
} from './integrations/provider.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

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

const DB_CONFIG = resolveDbConfig();
let providerCatalog: ProviderCatalog = createProviderCatalog();

const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  app.set('trust proxy', TRUST_PROXY === 'true' ? 1 : TRUST_PROXY);
}

const stores = await openStores(DB_CONFIG).catch((err) => {
  console.error(`Database: failed to open stores - ${errorMessage(err)}`);
  return null;
});

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ['*', 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }),
);

const authHandle: AuthHandle | null = stores ? initAuth(app, { auth: stores.auth }) : null;
if (!stores) app.use(createUnavailableGate());

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function selectionConfig(selection: Selection | undefined): Record<string, unknown> {
  return selection?.config ?? {};
}

function siemConfigFromSelection(
  selection: Selection | undefined,
  hasStoredConfig: boolean,
): SiemRuntimeConfig {
  const cfg = selectionConfig(selection);
  return {
    enabled: selection ? selection.enabled : !hasStoredConfig && SIEM_ENABLED,
    port: number(cfg.port, SIEM_PORT),
    host: text(cfg.host) || SIEM_HOST,
    retentionDays: number(cfg.retentionDays, SIEM_RETENTION_DAYS),
    maxPerQuery: SIEM_MAX_PER_QUERY,
  };
}

function disabledSiemHandle(bindError: string | null = null) {
  return {
    async configure() {},
    shutdown() {},
    status: () => ({
      enabled: false,
      configured: false,
      listening: false,
      host: SIEM_HOST,
      port: SIEM_PORT,
      bindError,
    }),
  };
}

async function applyRuntimeCapability(
  capabilityId: string,
  selection: Selection | undefined,
): Promise<void> {
  const provider = providerCatalog.providerByCapabilityId.get(capabilityId);
  if (provider) await provider.configure(selection);
  liveHealthCache = { data: null, ts: 0 };
}

async function applyRuntimeConfig(
  config: IntegrationConfig,
  opts: { includeLogs?: boolean } = {},
): Promise<void> {
  const hasStoredConfig = Object.keys(config).length > 0;
  if (!hasStoredConfig) return;
  const capabilityIds = providerCatalog.providers
    .map((provider) => provider.capabilityId)
    .filter((capabilityId) => opts.includeLogs || capabilityId !== 'logs');
  for (const capabilityId of capabilityIds) {
    await applyRuntimeCapability(capabilityId, config[capabilityId]);
  }
}

app.get('/api/health', (req, res) => {
  if (!req.auth) {
    return res.json({ ok: true });
  }
  const integrations = Object.fromEntries(
    providerCatalog.providers.map((provider) => {
      const status = readProviderStatus(provider);
      return [
        provider.healthId ?? provider.id,
        {
          enabled: status.enabled,
          configured: status.configured,
          ...(status.hasKey !== undefined ? { hasKey: status.hasKey } : {}),
        },
      ];
    }),
  );
  res.json({
    ok: true,
    ...integrations,
    wol: {
      enabled: wolStatus.enabled,
      configured: wolStatus.configured,
    },
  });
});

const LIVE_HEALTH_CACHE_TTL_MS = Number(process.env.HEALTH_LIVE_CACHE_TTL) || 12000;
const LIVE_HEALTH_PROBE_TIMEOUT_MS = Number(process.env.HEALTH_LIVE_TIMEOUT) || 5000;
const LIVE_HEALTH_FORCE_MIN_INTERVAL_MS =
  Number(process.env.HEALTH_LIVE_FORCE_MIN_INTERVAL) || 30000;

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
let liveHealthInFlight: Promise<LiveHealth> | null = null;

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

async function computeLiveHealth(): Promise<LiveHealth> {
  const probes = await Promise.all([
    ...providerCatalog.providers.map((provider) => {
      const status = readProviderStatus(provider);
      return runProbe(
        provider.healthId ?? provider.id,
        status.enabled && status.configured,
        () => provider.probe?.(LIVE_HEALTH_PROBE_TIMEOUT_MS) ?? true,
      );
    }),
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
  return result;
}

app.get('/api/health/live', async (req, res) => {
  const forceRequested = req.query.refresh === '1' || req.query.force === '1';
  const now = Date.now();
  const cacheAge = liveHealthCache.data ? now - liveHealthCache.ts : null;
  const forceAllowed =
    forceRequested &&
    (!liveHealthCache.data || cacheAge === null || cacheAge >= LIVE_HEALTH_FORCE_MIN_INTERVAL_MS);
  if (
    liveHealthCache.data &&
    ((!forceAllowed && forceRequested) ||
      (!forceRequested && cacheAge !== null && cacheAge < LIVE_HEALTH_CACHE_TTL_MS))
  ) {
    res.set('Cache-Control', 'no-store');
    return res.json({
      ...liveHealthCache.data,
      fromCache: true,
      ageMs: cacheAge,
      cacheTtlMs: LIVE_HEALTH_CACHE_TTL_MS,
      forceLimited: forceRequested && !forceAllowed,
    });
  }

  liveHealthInFlight ??= computeLiveHealth().finally(() => {
    liveHealthInFlight = null;
  });
  const result = await liveHealthInFlight;
  liveHealthCache = { data: result, ts: Date.now() };
  res.set('Cache-Control', 'no-store');
  res.json({
    ...result,
    fromCache: false,
    ageMs: 0,
    cacheTtlMs: LIVE_HEALTH_CACHE_TTL_MS,
    forceLimited: false,
  });
});

registerProxmoxNodeRoutes(app);
const proxmoxHistoryHandle = initProxmoxHistory(app);
registerWol(app);

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

const stateHandle = stores
  ? await initState(app, { store: stores.state }).catch((err) => {
      console.error(`State: init failed - ${err.message}`);
      return { shutdown() {} };
    })
  : { shutdown() {} };

const IMAGES_DIR =
  process.env.IMAGES_DIR || path.join(path.dirname(DB_CONFIG.sqlite.statePath), 'images');
if (stores) {
  initImages(app, { dir: IMAGES_DIR, store: stores.state });
}

if (stores) {
  await importEnvConfigIfEmpty(stores.state).catch((err) => {
    console.warn(`Setup: env config import failed - ${errorMessage(err)}`);
  });
}

const runtimeConfig: IntegrationConfig = stores
  ? await readIntegrationConfig(stores.state).catch((err) => {
      console.warn(`Setup: runtime config read failed - ${errorMessage(err)}`);
      return {};
    })
  : {};
const hasRuntimeConfig = Object.keys(runtimeConfig).length > 0;
if (process.env.NODE_ENV !== 'test') {
  process.on('SIGINT', () => {
    try {
      authHandle?.shutdown();
      stateHandle.shutdown();
    } catch {
      void 0;
    }
  });
  process.on('SIGTERM', () => {
    try {
      authHandle?.shutdown();
      stateHandle.shutdown();
    } catch {
      void 0;
    }
  });
}

const siemHandle = stores
  ? await initSiem(app, {
      store: stores.siem,
      ...siemConfigFromSelection(runtimeConfig.logs, hasRuntimeConfig),
    }).catch((err) => {
      console.error(`SIEM: init failed - ${err.message}`);
      return disabledSiemHandle(err.message);
    })
  : disabledSiemHandle();

function createSensorsProvider(): RuntimeProvider {
  return {
    id: 'sensors',
    capabilityId: 'sensors',
    logName: 'Sensors',
    status: () => sensorsHandle.status(),
    notConfiguredMessage:
      'SENSORS_MODE=ssh but no host configured (set SENSORS_SSH_HOST or GPU_SSH_HOST)',
    configure(selection) {
      const cfg = selectionConfig(selection);
      sensorsHandle.configure({
        enabled: !!selection?.enabled,
        mode: text(cfg.mode) || 'ssh',
        sshHost: text(cfg.sshHost) || gpuStatus.host,
        sshUser: SENSORS_SSH_USER,
        sshPort: SENSORS_SSH_PORT,
        sshKeyPath: SENSORS_SSH_KEY_PATH,
        cacheTtl: SENSORS_CACHE_TTL,
      });
    },
    probe() {
      return sensorsHandle.runSensors();
    },
  };
}

function createSiemProvider(): RuntimeProvider {
  return {
    id: 'siem',
    capabilityId: 'logs',
    logName: 'SIEM',
    status: () => siemHandle.status(),
    notConfiguredMessage: 'SIEM disabled or not configured.',
    configure(selection) {
      return siemHandle.configure(siemConfigFromSelection(selection, true));
    },
    probe() {
      const status = siemHandle.status();
      if (!status.listening) throw new Error(status.bindError || 'SIEM listener is not active');
      return true;
    },
  };
}

providerCatalog = createProviderCatalog([createSensorsProvider(), createSiemProvider()]);
for (const provider of providerCatalog.providers) registerProvider(app, provider);

await applyRuntimeConfig(runtimeConfig, { includeLogs: false }).catch((err) => {
  console.warn(`Setup: runtime config apply failed - ${errorMessage(err)}`);
});

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGINT', () => {
    try {
      siemHandle.shutdown();
      proxmoxHistoryHandle.shutdown();
    } catch {
      void 0;
    }
  });
  process.on('SIGTERM', () => {
    try {
      siemHandle.shutdown();
      proxmoxHistoryHandle.shutdown();
    } catch {
      void 0;
    }
  });
}

initSetup(app, {
  store: stores?.state,
  onSelectionChanged: async (capabilityId) => {
    if (!stores) return;
    const config = await readIntegrationConfig(stores.state);
    await applyRuntimeCapability(capabilityId, config[capabilityId]);
  },
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

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
    const sensorsStatus = sensorsHandle.status();
    if (sensorsStatus.enabled) {
      if (sensorsStatus.mode === 'local') {
        console.log('Sensors: enabled — local sensors -j');
      } else if (sensorsStatus.sshHost) {
        console.log(
          `Sensors: enabled — ssh ${SENSORS_SSH_USER}@${sensorsStatus.sshHost}:${SENSORS_SSH_PORT}`,
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

export { app, sensorsHandle, siemHandle, stateHandle, proxmoxHistoryHandle };
