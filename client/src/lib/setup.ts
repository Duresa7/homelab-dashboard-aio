import { useCallback, useEffect, useState } from 'react';

import { apiJson, jsonRequest } from './http';

export type CapabilityId = string;
export type ConfigFieldType =
  'text' | 'textarea' | 'url' | 'password' | 'number' | 'boolean' | 'select';
export type DbDriver = 'sqlite' | 'postgres' | 'mysql';

export interface ConfigField {
  name: string;
  label: string;
  type: ConfigFieldType;
  required: boolean;
  secret?: boolean;
  help?: string;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  env?: string;
}

export interface VendorProvider {
  id: string;
  label: string;
  icon: string;
  adapter: string;
  status: 'available' | 'planned';
  configSchema: ConfigField[];
}

export interface Capability {
  id: CapabilityId;
  label: string;
  integrationKey: string;
  providers: VendorProvider[];
}

export interface SetupStatus {
  onboardingComplete: boolean;
  configuredCapabilities: string[];
}

export interface RedactedCapabilityConfig {
  enabled: boolean;
  vendor: string;
  config: Record<string, unknown>;
  secrets: Record<string, boolean>;
  secretSource?: 'db' | 'env';
}

export interface RedactedConfig {
  capabilities: Record<CapabilityId, RedactedCapabilityConfig>;
  onboarding: { complete: boolean; completedAt?: string };
}

export interface SqliteConfig {
  statePath?: string;
  siemPath?: string;
}

export interface SqlServerConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export interface SqlServerConfigView extends Omit<SqlServerConfig, 'password'> {
  hasPassword?: boolean;
}

export type DbConfigBody =
  | { driver: 'sqlite'; sqlite?: SqliteConfig }
  | { driver: 'postgres'; postgres: SqlServerConfig }
  | { driver: 'mysql'; mysql: SqlServerConfig };

export type DbConfigView =
  | { driver: 'sqlite'; sqlite: SqliteConfig }
  | { driver: 'postgres'; postgres: SqlServerConfigView; sqlite?: SqliteConfig }
  | { driver: 'mysql'; mysql: SqlServerConfigView; sqlite?: SqliteConfig };

export interface TestResult {
  ok: boolean;
  error?: string;
  message?: string;
  configPatch?: Record<string, unknown>;
  untestable?: boolean;
}

export interface SaveDbResult {
  ok: true;
  restartRequired: true;
}

export interface SelectionInput {
  capability: CapabilityId;
  vendor: string;
  enabled?: boolean;
  config: Record<string, unknown>;
  secretSource?: 'db' | 'env';
}

export const SETUP_CONFIG_CHANGED_EVENT = 'homelab:setup-config-changed';

function notifySetupConfigChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SETUP_CONFIG_CHANGED_EVENT));
}

async function setupFetch<T>(url: string, init?: RequestInit): Promise<T> {
  return apiJson<T>(url, init);
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return setupFetch<SetupStatus>('/api/setup/status');
}

export async function getCapabilities(): Promise<Capability[]> {
  const res = await setupFetch<{ capabilities: Capability[] }>('/api/setup/capabilities');
  return res.capabilities;
}

export async function getConfig(): Promise<RedactedConfig> {
  return setupFetch<RedactedConfig>('/api/setup/config');
}

export async function putSelection(input: SelectionInput): Promise<{ ok: true }> {
  const result = await setupFetch<{ ok: true }>('/api/setup/config', jsonRequest('PUT', input));
  notifySetupConfigChanged();
  return result;
}

export async function testIntegration(input: {
  capability: CapabilityId;
  config: Record<string, unknown>;
}): Promise<TestResult> {
  return setupFetch<TestResult>('/api/setup/test', jsonRequest('POST', input));
}

export async function getDbConfig(): Promise<DbConfigView> {
  return setupFetch<DbConfigView>('/api/setup/db');
}

export async function testDbConnection(body: DbConfigBody): Promise<TestResult> {
  return setupFetch<TestResult>('/api/setup/db/test', jsonRequest('POST', body));
}

export async function saveDbConfig(body: DbConfigBody): Promise<SaveDbResult> {
  return setupFetch<SaveDbResult>('/api/setup/db', jsonRequest('POST', body));
}

export async function completeOnboarding(complete = true): Promise<{ ok: true }> {
  const result = await setupFetch<{ ok: true }>(
    '/api/setup/complete',
    jsonRequest('POST', { complete }),
  );
  notifySetupConfigChanged();
  return result;
}

export function useSetupStatus(): {
  status: SetupStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getSetupStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, error, refresh };
}

export function useCapabilities(): {
  capabilities: Capability[];
  loading: boolean;
  error: string | null;
} {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getCapabilities();
        if (cancelled) return;
        setCapabilities(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setCapabilities([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { capabilities, loading, error };
}
