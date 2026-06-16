import express from 'express';
import type { Express, Request, Response } from 'express';

import { withTtlCache, type CachedFn } from '../lib/cache.js';
import { isEnabled } from '../lib/env.js';
import { errorMessage } from '../lib/errors.js';
import { BlockedHostError } from '../lib/net-guard.js';
import { decryptSecret, getSecretKey } from '../lib/secrets.js';
import { makeSameOriginGuard } from '../state/index.js';
import { selectionConfig, text, bool, type Provider } from '../integrations/provider.js';
import type { Selection } from '../setup/integration-config.js';
import {
  createAmtClient,
  type AmtConnection,
  type AmtDeviceHardware as WsmanHardware,
} from './wsman.js';
import type {
  AmtDeviceConfig,
  AmtDeviceDefaults,
  AmtDeviceInput,
  DeviceRegistry,
} from './device-registry.js';
import type {
  AmtApiResponse,
  AmtData,
  AmtDeviceHardware,
  AmtDeviceStatus,
  AmtPowerAction,
} from '../../../shared/wire.ts';

const DEFAULT_PORT = 16993;
const DEFAULT_USERNAME = 'admin';
const DEFAULT_POLL_INTERVAL = 15000;

/** Friendly power actions accepted by `POST /api/amt/power`. */
const POWER_ACTIONS = new Set<AmtPowerAction>([
  'on',
  'off',
  'cycle',
  'reset',
  'shutdown',
  'graceful-reset',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AmtRuntimeConfig {
  enabled: boolean;
  defaultPort: number;
  useTls: boolean;
  defaultUsername: string;
  pollInterval: number;
}

/** A device with the encrypted password removed — safe to return to clients. */
export type AmtDevicePublic = Omit<AmtDeviceConfig, 'password'>;

class BadRequestError extends Error {}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function configFromEnv(): AmtRuntimeConfig {
  return {
    enabled: isEnabled(process.env.AMT_ENABLED, false),
    defaultPort: numberOr(process.env.AMT_DEFAULT_PORT, DEFAULT_PORT),
    useTls: isEnabled(process.env.AMT_USE_TLS, true),
    defaultUsername: process.env.AMT_DEFAULT_USERNAME || DEFAULT_USERNAME,
    pollInterval: numberOr(process.env.AMT_POLL_INTERVAL, DEFAULT_POLL_INTERVAL),
  };
}

let config = configFromEnv();

// The device registry is created in index.ts (it needs the state store and the
// at-rest secret key) and injected here by registerAmtRoutes. The provider's
// fetch/probe read it through this module-level handle.
let deviceRegistry: DeviceRegistry | null = null;

export const amtStatus = {
  enabled: config.enabled,
  configured: config.enabled,
};

/** Defaults applied to device fields left unset, sourced from the live config. */
function currentDefaults(): AmtDeviceDefaults {
  return {
    port: config.defaultPort,
    username: config.defaultUsername,
    useTls: config.useTls,
  };
}

function toConnection(device: AmtDeviceConfig, key: Buffer): AmtConnection {
  return {
    host: device.host,
    port: device.port,
    username: device.username,
    password: decryptSecret(device.password, key),
    useTls: device.useTls,
  };
}

function redact(device: AmtDeviceConfig): AmtDevicePublic {
  return {
    id: device.id,
    name: device.name,
    host: device.host,
    port: device.port,
    username: device.username,
    useTls: device.useTls,
  };
}

/** Map the WSMAN client's hardware shape onto the dashboard wire shape. */
function mapHardware(hw: WsmanHardware, amtVersion: string | null): AmtDeviceHardware {
  const slots = hw.memory.map((m) => ({
    sizeMB: m.capacityBytes != null ? Math.round(m.capacityBytes / 1_048_576) : 0,
    speedMHz: m.speedMhz ?? 0,
    type: m.memoryType ?? '',
    manufacturer: '',
  }));
  return {
    cpu: hw.cpu
      ? { model: hw.cpu.model, cores: hw.cpu.cores ?? 0, maxSpeedMHz: hw.cpu.maxSpeedMhz ?? 0 }
      : null,
    memory: slots.length ? { totalMB: slots.reduce((sum, s) => sum + s.sizeMB, 0), slots } : null,
    bios: hw.bios
      ? {
          vendor: hw.bios.vendor ?? '',
          version: hw.bios.version ?? '',
          date: hw.bios.releaseDate ?? '',
        }
      : null,
    nics: hw.nics.map((n) => ({
      mac: n.mac ?? '',
      linkStatus: n.linkUp === true ? 'up' : n.linkUp === false ? 'down' : 'unknown',
    })),
    amtVersion: amtVersion || null,
  };
}

/** Fetch + map hardware inventory, tolerating an enumeration hiccup by yielding
 * null rather than failing the whole poll. */
async function loadHardware(
  client: ReturnType<typeof createAmtClient>,
): Promise<AmtDeviceHardware | null> {
  try {
    const [hw, general] = await Promise.all([
      client.getHardwareInventory(),
      client.getGeneralSettings(),
    ]);
    return mapHardware(hw, general.amtVersion);
  } catch {
    return null;
  }
}

/** Poll a single device: power state always, hardware inventory best-effort.
 * Throws only when the device is unreachable (power query failed). */
async function fetchDeviceStatus(device: AmtDeviceConfig, key: Buffer): Promise<AmtDeviceStatus> {
  const client = createAmtClient(toConnection(device, key));
  const powerState = await client.getPowerState();
  const hardware = await loadHardware(client);

  return {
    id: device.id,
    name: device.name,
    host: device.host,
    powerState,
    reachable: true,
    error: null,
    hardware,
    lastSeenAt: Date.now(),
  };
}

function unreachableStatus(device: AmtDeviceConfig, reason: unknown): AmtDeviceStatus {
  return {
    id: device.id,
    name: device.name,
    host: device.host,
    powerState: 'unknown',
    reachable: false,
    error: errorMessage(reason),
    hardware: null,
    lastSeenAt: null,
  };
}

function emptyData(): AmtData {
  return { devices: [], total: 0, online: 0, offline: 0, unreachable: 0 };
}

async function fetchAmtDataRaw(): Promise<AmtApiResponse> {
  const devices = deviceRegistry ? await deviceRegistry.list() : [];
  if (devices.length === 0) return { amt: emptyData() };

  const key = await getSecretKey();
  const settled = await Promise.allSettled(devices.map((d) => fetchDeviceStatus(d, key)));
  const statuses = settled.map((result, i) =>
    result.status === 'fulfilled' ? result.value : unreachableStatus(devices[i], result.reason),
  );

  const online = statuses.filter((s) => s.reachable && s.powerState === 'on').length;
  const unreachable = statuses.filter((s) => !s.reachable).length;

  return {
    amt: {
      devices: statuses,
      total: statuses.length,
      online,
      offline: statuses.length - online - unreachable,
      unreachable,
    },
  };
}

let cachedFetch: CachedFn<AmtApiResponse> = withTtlCache(fetchAmtDataRaw, config.pollInterval);

function cachedFetchAmtData(): Promise<AmtApiResponse> {
  return cachedFetch();
}

/** Drop the poll cache so the next GET /api/amt reflects a state-changing write
 * (power action, device add/remove). */
export function clearAmtCache(): void {
  cachedFetch.clear();
}

async function probeAmt(): Promise<unknown> {
  const devices = deviceRegistry ? await deviceRegistry.list() : [];
  if (devices.length === 0) throw new Error('No AMT devices configured');
  const key = await getSecretKey();
  const client = createAmtClient(toConnection(devices[0], key));
  return client.getGeneralSettings();
}

async function debugAmt(): Promise<unknown> {
  const devices = deviceRegistry ? await deviceRegistry.list() : [];
  const state = cachedFetch.peek();
  return {
    config,
    deviceCount: devices.length,
    cache: { ts: state.ts, lastError: state.lastError, hasData: state.data != null },
  };
}

export function configureAmt(selection: Selection | undefined): void {
  const cfg = selectionConfig(selection);
  config = {
    enabled: !!selection?.enabled,
    defaultPort: numberOr(cfg.defaultPort, DEFAULT_PORT),
    useTls: bool(cfg.useTls, true),
    defaultUsername: text(cfg.defaultUsername) || DEFAULT_USERNAME,
    pollInterval: numberOr(cfg.pollInterval, DEFAULT_POLL_INTERVAL),
  };
  cachedFetch = withTtlCache(fetchAmtDataRaw, config.pollInterval);
  amtStatus.enabled = config.enabled;
  amtStatus.configured = config.enabled;
}

export const amtProvider: Provider<AmtApiResponse> = {
  id: 'amt',
  capabilityId: 'amt',
  logName: 'AMT',
  status: amtStatus,
  notConfiguredMessage: 'Intel AMT not configured — add devices in settings.',
  errorLogLevel: 'warn',
  configure: configureAmt,
  fetch: cachedFetchAmtData,
  probe: probeAmt,
  debug: debugAmt,
};

// ---------------------------------------------------------------------------
// Request parsing / validation
// ---------------------------------------------------------------------------

function parseDeviceInput(body: unknown): AmtDeviceInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = text(b.name);
  if (!name) throw new BadRequestError('name is required');

  const host = text(b.host);
  if (!host) throw new BadRequestError('host is required');

  const password = typeof b.password === 'string' ? b.password : '';
  if (!password) throw new BadRequestError('password is required');

  const input: AmtDeviceInput = { name, host, password };

  if (b.port !== undefined && b.port !== null && b.port !== '') {
    const port = Number(b.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestError('port must be an integer from 1 to 65535');
    }
    input.port = port;
  }

  const username = text(b.username);
  if (username) input.username = username;

  if (typeof b.useTls === 'boolean') input.useTls = b.useTls;

  return input;
}

function writeError(res: Response, err: unknown): void {
  if (err instanceof BadRequestError || err instanceof BlockedHostError) {
    res.status(400).json({ error: errorMessage(err) });
    return;
  }
  res.status(502).json({ error: errorMessage(err) });
}

/** Register the AMT custom routes and wire in the device registry. The standard
 * `GET /api/amt` is created separately by registerProvider(). */
export function registerAmtRoutes(app: Express, registry: DeviceRegistry | null): void {
  deviceRegistry = registry;

  const parseJsonBody = express.json({ limit: '32kb' });
  const sameOrigin = makeSameOriginGuard();

  const requireRegistry = (res: Response): boolean => {
    if (!registry) {
      res.status(503).json({ error: amtProvider.notConfiguredMessage });
      return false;
    }
    return true;
  };

  app.get('/api/amt/devices', async (_req: Request, res: Response) => {
    if (!requireRegistry(res)) return;
    try {
      const devices = await registry!.list();
      res.json({ devices: devices.map(redact) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  app.get('/api/amt/devices/:id/inventory', async (req: Request, res: Response) => {
    if (!requireRegistry(res)) return;
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid device id' });
    try {
      const device = await registry!.get(id);
      if (!device) return res.status(404).json({ error: 'device not found' });
      const key = await getSecretKey();
      const client = createAmtClient(toConnection(device, key));
      const [hw, general] = await Promise.all([
        client.getHardwareInventory(),
        client.getGeneralSettings(),
      ]);
      res.json({ inventory: mapHardware(hw, general.amtVersion) });
    } catch (err) {
      console.warn(`AMT inventory error:`, errorMessage(err));
      res.status(502).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/amt/power', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    if (!requireRegistry(res)) return;
    try {
      const body = (req.body ?? {}) as { deviceId?: unknown; action?: unknown };
      const deviceId = text(body.deviceId);
      if (!deviceId || !UUID_RE.test(deviceId)) {
        throw new BadRequestError('a valid deviceId is required');
      }
      const action = body.action;
      if (typeof action !== 'string' || !POWER_ACTIONS.has(action as AmtPowerAction)) {
        throw new BadRequestError(`action must be one of: ${[...POWER_ACTIONS].join(', ')}`);
      }
      const device = await registry!.get(deviceId);
      if (!device) return res.status(404).json({ error: 'device not found' });

      const key = await getSecretKey();
      const client = createAmtClient(toConnection(device, key));
      const { returnValue } = await client.requestPowerAction(action as AmtPowerAction);
      clearAmtCache();
      res.json({ ok: true, returnValue });
    } catch (err) {
      writeError(res, err);
    }
  });

  app.post('/api/amt/devices', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    if (!requireRegistry(res)) return;
    try {
      const input = parseDeviceInput(req.body);
      const device = await registry!.upsert(input, currentDefaults());
      clearAmtCache();
      res.status(201).json({ device: redact(device) });
    } catch (err) {
      writeError(res, err);
    }
  });

  app.put(
    '/api/amt/devices/:id',
    sameOrigin,
    parseJsonBody,
    async (req: Request, res: Response) => {
      if (!requireRegistry(res)) return;
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid device id' });
      try {
        const existing = await registry!.get(id);
        if (!existing) return res.status(404).json({ error: 'device not found' });
        const input = parseDeviceInput(req.body);
        input.id = id;
        const device = await registry!.upsert(input, currentDefaults());
        clearAmtCache();
        res.json({ device: redact(device) });
      } catch (err) {
        writeError(res, err);
      }
    },
  );

  app.delete('/api/amt/devices/:id', sameOrigin, async (req: Request, res: Response) => {
    if (!requireRegistry(res)) return;
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid device id' });
    try {
      const removed = await registry!.remove(id);
      if (!removed) return res.status(404).json({ error: 'device not found' });
      clearAmtCache();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });
}
