import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { assertAllowedHost, BlockedHostError, hostFromInput } from '../lib/net-guard.js';
import { encryptSecret, isEncryptedValue, type EncryptedValue } from '../lib/secrets.js';
import type { StateStore } from '../storage/types.js';

/** `app_state` key holding the JSON array of AMT devices. */
export const AMT_DEVICES_KEY = 'amt.devices';

/** A stored AMT device. The password stays encrypted at rest; decryption only
 * happens in the WSMAN client layer when a connection is established. */
export interface AmtDeviceConfig {
  id: string; // crypto.randomUUID()
  name: string; // user-friendly label
  host: string; // IP or hostname
  port: number; // default from capability config
  username: string; // default from capability config
  password: EncryptedValue; // AES-256-GCM encrypted
  useTls: boolean; // default from capability config
}

/** Caller-supplied device fields. `id` present → update, absent → create. */
export interface AmtDeviceInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  username?: string;
  password: string; // plaintext — encrypted before storage
  useTls?: boolean;
}

/** Global defaults sourced from the AMT capability config, applied to any field
 * the caller leaves unset. */
export interface AmtDeviceDefaults {
  port: number;
  username: string;
  useTls: boolean;
}

export interface DeviceRegistry {
  list(): Promise<AmtDeviceConfig[]>;
  get(id: string): Promise<AmtDeviceConfig | null>;
  upsert(input: AmtDeviceInput, defaults: AmtDeviceDefaults): Promise<AmtDeviceConfig>;
  remove(id: string): Promise<boolean>;
}

function isLoopbackIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ip.startsWith('127.');
  if (kind !== 6) return false;
  const addr = ip.toLowerCase().split('%')[0];
  if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') return true;
  const mapped = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(addr);
  return mapped ? isLoopbackIp(mapped[1]) : false;
}

async function assertAllowedAmtHost(input: string): Promise<void> {
  await assertAllowedHost(input);

  const host = hostFromInput(input);
  if (isLoopbackIp(host)) {
    throw new BlockedHostError(`AMT device host ${host} is not allowed`);
  }
  if (isIP(host)) return;

  try {
    const resolved = await lookup(host, { all: true });
    for (const { address } of resolved) {
      if (isLoopbackIp(address)) {
        throw new BlockedHostError(`AMT device host "${host}" resolves to a loopback address`);
      }
    }
  } catch (err) {
    if (err instanceof BlockedHostError) throw err;
  }
}

/** Narrow an arbitrary stored value to a well-formed device, dropping anything
 * that doesn't match (e.g. a hand-edited or partially-written blob). */
function isDeviceConfig(value: unknown): value is AmtDeviceConfig {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Partial<AmtDeviceConfig>;
  return (
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    typeof d.host === 'string' &&
    typeof d.port === 'number' &&
    typeof d.username === 'string' &&
    typeof d.useTls === 'boolean' &&
    isEncryptedValue(d.password)
  );
}

export function createDeviceRegistry(store: StateStore, secretKey: Buffer): DeviceRegistry {
  async function readAll(): Promise<AmtDeviceConfig[]> {
    const entry = await store.get(AMT_DEVICES_KEY);
    if (!entry || !Array.isArray(entry.value)) return [];
    return entry.value.filter(isDeviceConfig);
  }

  async function writeAll(devices: AmtDeviceConfig[]): Promise<void> {
    await store.put(AMT_DEVICES_KEY, devices);
  }

  return {
    async list() {
      return readAll();
    },

    async get(id) {
      const devices = await readAll();
      return devices.find((d) => d.id === id) ?? null;
    },

    async upsert(input, defaults) {
      // AMT endpoints must be real out-of-band controllers, not this dashboard
      // process or cloud-metadata/link-local addresses.
      await assertAllowedAmtHost(input.host);

      const devices = await readAll();
      const idx = input.id ? devices.findIndex((d) => d.id === input.id) : -1;
      const existing = idx >= 0 ? devices[idx] : null;

      const device: AmtDeviceConfig = {
        id: existing?.id ?? randomUUID(),
        name: input.name,
        host: input.host,
        port: input.port ?? existing?.port ?? defaults.port,
        username: input.username ?? existing?.username ?? defaults.username,
        password: encryptSecret(input.password, secretKey),
        useTls: input.useTls ?? existing?.useTls ?? defaults.useTls,
      };

      if (idx >= 0) devices[idx] = device;
      else devices.push(device);
      await writeAll(devices);
      return device;
    },

    async remove(id) {
      const devices = await readAll();
      const next = devices.filter((d) => d.id !== id);
      if (next.length === devices.length) return false;
      await writeAll(next);
      return true;
    },
  };
}
