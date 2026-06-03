// Runtime integration config, persisted in the state DB under `setup.`-prefixed
// keys (hidden from the public /api/state API so secrets never reach the client
// in bulk). The onboarding UI reads a redacted view and writes selections here;
// integrations consume it in issue 03.
import {
  CAPABILITIES,
  getCapability,
  getProvider,
  type ConfigField,
} from '../capabilities/registry.js';
import { isEnabled } from '../lib/env.js';
import type { StateStore } from '../storage/types.js';

export const CONFIG_KEY = 'setup.integrationConfig';
export const ONBOARDING_KEY = 'setup.onboarding';

export interface Selection {
  enabled: boolean;
  vendor: string;
  config: Record<string, unknown>;
}
export type IntegrationConfig = Record<string, Selection>;
export interface OnboardingState {
  complete: boolean;
  completedAt?: string;
}

// Per-capability enable flag from the current env-configured integration. Kept
// here (not in the pure registry) since it only drives the one-time env import.
const ENABLE_ENV: Record<string, string> = {
  datacenter: 'PROXMOX_ENABLED',
  network: 'UNIFI_ENABLED',
  nas: 'UNAS_ENABLED',
  cameras: 'PROTECT_ENABLED',
  containers: 'PORTAINER_ENABLED',
  gpu: 'GPU_ENABLED',
  sensors: 'SENSORS_ENABLED',
  logs: 'SIEM_ENABLED',
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

async function readConfig(store: StateStore): Promise<IntegrationConfig> {
  const row = await store.get(CONFIG_KEY);
  return (row?.value as IntegrationConfig | undefined) ?? {};
}

async function readOnboarding(store: StateStore): Promise<OnboardingState> {
  const row = await store.get(ONBOARDING_KEY);
  return (row?.value as OnboardingState | undefined) ?? { complete: false };
}

/** Build selections from env (the available provider per enabled capability). */
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
      const raw = field.env ? env[field.env] : undefined;
      if (raw != null && raw !== '') {
        const value = coerceField(field, raw);
        if (value !== undefined) cfg[field.name] = value;
      }
    }
    config[cap.id] = { enabled: true, vendor: provider.id, config: cfg };
  }
  if (Object.keys(config).length === 0) return null;
  return { config, onboarding: { complete: true, completedAt: nowIso } };
}

/**
 * One-time env import: if the store has no config yet, seed it from env and mark
 * onboarding complete so existing installs skip the wizard. Idempotent — a later
 * boot sees the existing config and leaves user edits untouched.
 */
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

/** Selections for the UI, with secret values replaced by presence markers. */
export async function getRedactedConfig(store: StateStore): Promise<{
  capabilities: Record<string, unknown>;
  onboarding: OnboardingState;
}> {
  const config = await readConfig(store);
  const onboarding = await readOnboarding(store);
  const capabilities: Record<string, unknown> = {};
  for (const [capId, sel] of Object.entries(config)) {
    const provider = getProvider(capId, sel.vendor);
    const secretFields = new Set(
      (provider?.configSchema ?? []).filter((f) => f.secret).map((f) => f.name),
    );
    const safeConfig: Record<string, unknown> = {};
    const secrets: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(sel.config)) {
      if (secretFields.has(key)) secrets[key] = value != null && value !== '';
      else safeConfig[key] = value;
    }
    capabilities[capId] = { enabled: sel.enabled, vendor: sel.vendor, config: safeConfig, secrets };
  }
  return { capabilities, onboarding };
}

interface SelectionInput {
  capability?: unknown;
  vendor?: unknown;
  enabled?: unknown;
  config?: unknown;
}

/**
 * Upsert one capability's selection, validated against the provider's
 * configSchema. Secret fields omitted by the caller keep their stored value
 * (so the client never has to round-trip a secret it was never shown).
 */
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
  const config = await readConfig(store);
  const existing = config[capabilityId]?.config ?? {};

  const merged: Record<string, unknown> = {};
  for (const field of provider.configSchema) {
    let value: unknown;
    if (field.name in incoming) value = coerceField(field, incoming[field.name]);
    else if (field.name in existing) value = existing[field.name];
    else if (field.default !== undefined) value = field.default;

    if (field.required && (value === undefined || value === '')) {
      throw new ConfigError(`missing required field: ${field.name}`);
    }
    if (value !== undefined) merged[field.name] = value;
  }

  config[capabilityId] = { enabled: input.enabled !== false, vendor, config: merged };
  await store.put(CONFIG_KEY, config);
}
