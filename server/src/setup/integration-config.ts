import { isIP } from 'node:net';

import {
  CAPABILITIES,
  getCapability,
  getProvider,
  type ConfigField,
} from '../capabilities/registry.js';
import { isEnabled } from '../lib/env.js';
import { errorMessage } from '../lib/errors.js';
import { assertAllowedHost, BlockedHostError, hostFromInput } from '../lib/net-guard.js';
import { decryptSecret, encryptSecret, getSecretKey, isEncryptedValue } from '../lib/secrets.js';
import type { StateStore } from '../storage/types.js';

export const CONFIG_KEY = 'setup.integrationConfig';
export const ONBOARDING_KEY = 'setup.onboarding';

export interface Selection {
  enabled: boolean;
  vendor: string;
  config: Record<string, unknown>;
  /** Where secret fields live: encrypted in this store ('db', the default) or
   * read from `process.env` at runtime ('env'). */
  secretSource?: 'db' | 'env';
}
export type IntegrationConfig = Record<string, Selection>;
export interface OnboardingState {
  complete: boolean;
  completedAt?: string;
}

const ENABLE_ENV: Record<string, string> = {
  datacenter: 'PROXMOX_ENABLED',
  network: 'UNIFI_ENABLED',
  nas: 'UNAS_ENABLED',
  containers: 'PORTAINER_ENABLED',
  gpu: 'GPU_ENABLED',
  sensors: 'SENSORS_ENABLED',
  logs: 'SIEM_ENABLED',
  amt: 'AMT_ENABLED',
};

class ConfigError extends Error {}
export { ConfigError };

function coerceField(field: ConfigField, raw: unknown): unknown {
  if (field.type === 'boolean')
    return typeof raw === 'boolean' ? raw : isEnabled(String(raw), false);
  if (field.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return typeof raw === 'string' ? raw : String(raw);
}

/** Reject host values that carry whitespace, an `@`, slashes, or a leading `-`
 * (which `ssh` would read as an option). Defense-in-depth on top of the
 * shell-free execFile in runRemote. */
function isSafeHostname(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 253) return false;
  if (/[\s@/\\]/.test(v) || v.startsWith('-')) return false;
  return isIP(v) !== 0 || /^[A-Za-z0-9._-]+$/.test(v);
}

/** Enforce the schema's own constraints that the registry declares but
 * coerceField doesn't apply: select option allowlists and hostname fields. */
function validateFieldValue(field: ConfigField, value: unknown): void {
  if (value === undefined || value === '') return;
  if (field.type === 'select' && field.options) {
    const allowed = field.options.map((o) => o.value);
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw new ConfigError(
        `invalid value for ${field.name}: expected one of ${allowed.join(', ')}`,
      );
    }
  }
  if (field.format === 'hostname' && typeof value === 'string' && !isSafeHostname(value)) {
    throw new ConfigError(`invalid host for ${field.name}`);
  }
}

async function readConfig(store: StateStore): Promise<IntegrationConfig> {
  const row = await store.get(CONFIG_KEY);
  return (row?.value as IntegrationConfig | undefined) ?? {};
}

/** Turn stored secret fields into plaintext for server-side consumption: decrypt
 * 'db' blobs, and read 'env'-sourced fields from `process.env`. A decrypt failure
 * (key changed or data corrupt) drops the field rather than crashing. */
function resolveSecrets(
  capabilityId: string,
  selection: Selection,
  key: Buffer,
): Record<string, unknown> {
  const provider = getProvider(capabilityId, selection.vendor);
  if (!provider) return selection.config;
  const out: Record<string, unknown> = { ...selection.config };
  for (const field of provider.configSchema) {
    if (!field.secret) continue;
    if (selection.secretSource === 'env') {
      const envVal = field.env ? process.env[field.env]?.trim() : undefined;
      if (envVal) out[field.name] = envVal;
      else delete out[field.name];
      continue;
    }
    const stored = out[field.name];
    if (isEncryptedValue(stored)) {
      try {
        out[field.name] = decryptSecret(stored, key);
      } catch {
        console.warn(
          `Setup: could not decrypt ${capabilityId}.${field.name} (encryption key changed or data corrupt); re-enter it in setup`,
        );
        delete out[field.name];
      }
    }
    // a plain string here is a legacy plaintext secret: used as-is and
    // re-encrypted by migrateSecretsAtRest or the next save
  }
  return out;
}

export async function readIntegrationConfig(store: StateStore): Promise<IntegrationConfig> {
  const config = await readConfig(store);
  const key = await getSecretKey();
  const resolved: IntegrationConfig = {};
  for (const [capId, selection] of Object.entries(config)) {
    resolved[capId] = { ...selection, config: resolveSecrets(capId, selection, key) };
  }
  return resolved;
}

async function readOnboarding(store: StateStore): Promise<OnboardingState> {
  const row = await store.get(ONBOARDING_KEY);
  return (row?.value as OnboardingState | undefined) ?? { complete: false };
}

export function importConfigFromEnv(
  env: NodeJS.ProcessEnv,
  nowIso: string,
): { config: IntegrationConfig; onboarding: OnboardingState } | null {
  const config: IntegrationConfig = {};
  for (const cap of CAPABILITIES) {
    const provider = cap.providers.find((p) => p.status === 'available');
    if (!provider) continue;
    const enableEnv = ENABLE_ENV[cap.id];
    if (!enableEnv || !isEnabled(env[enableEnv], false)) continue;

    const cfg: Record<string, unknown> = {};
    for (const field of provider.configSchema) {
      // Secret fields stay in the environment and are resolved at read time, so
      // an env-configured deployment never copies its keys into the database.
      if (field.secret) continue;
      const raw = field.env ? env[field.env] : undefined;
      if (raw != null && raw !== '') {
        const value = coerceField(field, raw);
        if (value !== undefined) cfg[field.name] = value;
      }
    }
    config[cap.id] = { enabled: true, vendor: provider.id, config: cfg, secretSource: 'env' };
  }
  if (Object.keys(config).length === 0) return null;
  return { config, onboarding: { complete: true, completedAt: nowIso } };
}

export async function importEnvConfigIfEmpty(
  store: StateStore,
  env: NodeJS.ProcessEnv = process.env,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  if (await store.get(CONFIG_KEY)) return;
  const imported = importConfigFromEnv(env, nowIso);
  if (!imported) return;
  await store.put(CONFIG_KEY, imported.config);
  await store.put(ONBOARDING_KEY, imported.onboarding);
}

/** One-time, best-effort: encrypt any legacy plaintext secrets left in the store
 * by a version that predates at-rest encryption. Idempotent (skips blobs and
 * env-sourced selections). */
export async function migrateSecretsAtRest(store: StateStore): Promise<void> {
  const config = await readConfig(store);
  let key: Buffer | null = null;
  let changed = false;
  for (const [capId, selection] of Object.entries(config)) {
    if (selection.secretSource === 'env') continue;
    const provider = getProvider(capId, selection.vendor);
    if (!provider) continue;
    for (const field of provider.configSchema) {
      if (!field.secret) continue;
      const value = selection.config[field.name];
      if (typeof value === 'string' && value !== '') {
        key ??= await getSecretKey();
        selection.config[field.name] = encryptSecret(value, key);
        changed = true;
      }
    }
  }
  if (changed) await store.put(CONFIG_KEY, config);
}

export async function markOnboardingComplete(
  store: StateStore,
  complete = true,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await store.put(
    ONBOARDING_KEY,
    complete ? { complete: true, completedAt: nowIso } : { complete: false },
  );
}

export async function readSelectionConfig(
  store: StateStore,
  capabilityId: string,
): Promise<Record<string, unknown>> {
  const config = await readConfig(store);
  const selection = config[capabilityId];
  if (!selection) return {};
  const key = await getSecretKey();
  return resolveSecrets(capabilityId, selection, key);
}

export async function getStatus(
  store: StateStore,
): Promise<{ onboardingComplete: boolean; configuredCapabilities: string[] }> {
  const config = await readConfig(store);
  const onboarding = await readOnboarding(store);
  return {
    onboardingComplete: Boolean(onboarding.complete),
    configuredCapabilities: Object.entries(config)
      .filter(([, sel]) => sel.enabled)
      .map(([id]) => id),
  };
}

export async function getRedactedConfig(store: StateStore): Promise<{
  capabilities: Record<string, unknown>;
  onboarding: OnboardingState;
}> {
  const config = await readConfig(store);
  const onboarding = await readOnboarding(store);
  const capabilities: Record<string, unknown> = {};
  for (const [capId, sel] of Object.entries(config)) {
    const provider = getProvider(capId, sel.vendor);
    const schema = provider?.configSchema ?? [];
    const secretFields = new Set(schema.filter((f) => f.secret).map((f) => f.name));
    const source: 'db' | 'env' = sel.secretSource === 'env' ? 'env' : 'db';

    const safeConfig: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sel.config)) {
      if (!secretFields.has(key)) safeConfig[key] = value;
    }

    // Report a secret as set without revealing it: in env mode that means the
    // variable is present in the environment; in db mode that there is a stored
    // (encrypted) value.
    const secrets: Record<string, boolean> = {};
    for (const field of schema) {
      if (!field.secret) continue;
      if (source === 'env') {
        secrets[field.name] = Boolean(field.env && process.env[field.env]?.trim());
      } else {
        const stored = sel.config[field.name];
        secrets[field.name] =
          isEncryptedValue(stored) || (typeof stored === 'string' && stored !== '');
      }
    }

    capabilities[capId] = {
      enabled: sel.enabled,
      vendor: sel.vendor,
      config: safeConfig,
      secrets,
      secretSource: source,
    };
  }
  return { capabilities, onboarding };
}

interface SelectionInput {
  capability?: unknown;
  vendor?: unknown;
  enabled?: unknown;
  config?: unknown;
  secretSource?: unknown;
}

export async function upsertSelection(store: StateStore, input: SelectionInput): Promise<void> {
  const capabilityId = typeof input.capability === 'string' ? input.capability : '';
  const vendor = typeof input.vendor === 'string' ? input.vendor : '';
  const cap = getCapability(capabilityId);
  if (!cap) throw new ConfigError('unknown capability');
  const provider = cap.providers.find((p) => p.id === vendor);
  if (!provider) throw new ConfigError('unknown vendor for capability');
  if (provider.status !== 'available') throw new ConfigError(`vendor "${vendor}" is not available`);

  const incoming =
    input.config && typeof input.config === 'object'
      ? (input.config as Record<string, unknown>)
      : {};
  const enabled = input.enabled !== false;
  const config = await readConfig(store);
  // Index by the registry's canonical id (cap.id === capabilityId here, but
  // sourced from the allowlist) so neither read nor write keys on raw user input.
  const existingSelection = config[cap.id];
  const existing = existingSelection?.config ?? {};
  const secretSource: 'db' | 'env' =
    input.secretSource === 'env'
      ? 'env'
      : input.secretSource === 'db'
        ? 'db'
        : (existingSelection?.secretSource ?? 'db');

  // If the caller points this integration at a different host than the stored
  // one, any secret it omits must be re-supplied. Otherwise a stored secret
  // would be inherited and sent to the new (attacker-chosen) destination on the
  // next fetch. A missing stored baseUrl counts as "changed".
  const existingHost = typeof existing.baseUrl === 'string' ? hostFromInput(existing.baseUrl) : '';
  const incomingHost =
    'baseUrl' in incoming && typeof incoming.baseUrl === 'string'
      ? hostFromInput(incoming.baseUrl)
      : '';
  const hostChanged =
    incomingHost !== '' && incomingHost.toLowerCase() !== existingHost.toLowerCase();

  const key = await getSecretKey();
  const merged: Record<string, unknown> = {};
  for (const field of provider.configSchema) {
    // In env mode the secret lives in process.env, never in the store, and is
    // exempt from the required-field check below (resolved at runtime).
    if (field.secret && secretSource === 'env') continue;

    let value: unknown;
    if (field.name in incoming) {
      const coerced = coerceField(field, incoming[field.name]);
      if (field.secret) {
        if (typeof coerced === 'string' && coerced.trim() !== '') {
          value = encryptSecret(coerced, key);
        } else if (field.name in existing) {
          value = existing[field.name]; // blank submitted: keep the saved value
        }
      } else {
        value = coerced;
      }
    } else if (field.secret && hostChanged && field.name in existing) {
      throw new ConfigError(`secret fields are required when changing the base URL: ${field.name}`);
    } else if (field.name in existing) {
      value = existing[field.name];
    } else if (field.default !== undefined) {
      value = field.default;
    }

    if (!field.secret) validateFieldValue(field, value);

    if (enabled && field.required && (value === undefined || value === '')) {
      throw new ConfigError(`missing required field: ${field.name}`);
    }
    if (value !== undefined) merged[field.name] = value;
  }

  // Defense-in-depth SSRF guard: never persist a base URL that points at the
  // dashboard's own loopback or the link-local/metadata range.
  for (const field of provider.configSchema) {
    if (field.type !== 'url') continue;
    const value = merged[field.name];
    if (typeof value !== 'string' || !value) continue;
    try {
      await assertAllowedHost(value);
    } catch (err) {
      if (err instanceof BlockedHostError) throw new ConfigError(errorMessage(err));
      throw err;
    }
  }

  config[cap.id] = { enabled, vendor, config: merged, secretSource };
  await store.put(CONFIG_KEY, config);
}
