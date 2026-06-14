import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSecretKeyCache } from '../lib/secrets.js';
import { openStateDb } from '../state/db.js';
import type { StateStore } from '../storage/types.js';
import {
  CONFIG_KEY,
  getRedactedConfig,
  getStatus,
  importConfigFromEnv,
  importEnvConfigIfEmpty,
  migrateSecretsAtRest,
  readSelectionConfig,
  upsertSelection,
  type IntegrationConfig,
} from './integration-config.js';

let tempDir: string;
let store: StateStore;

const ENV = {
  PROXMOX_ENABLED: 'true',
  PROXMOX_BASE_URL: 'https://pve.example.test',
  PROXMOX_TOKEN_ID: 'root@pam!tok',
  PROXMOX_TOKEN_SECRET: 'super-secret',
  PROXMOX_NODE: 'pve1',
  UNIFI_ENABLED: 'true',
  UNIFI_BASE_URL: 'https://unifi.example.test',
  UNIFI_API_KEY: 'unifi-key',
};

beforeEach(async () => {
  vi.stubEnv('APP_ENCRYPTION_KEY', 'a'.repeat(64));
  resetSecretKeyCache();
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-cfg-test-'));
  store = await openStateDb(path.join(tempDir, 'state.sqlite'));
});
afterEach(async () => {
  await store.close();
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetSecretKeyCache();
});

describe('importConfigFromEnv', () => {
  it('builds env-sourced selections and keeps secrets out of the store', () => {
    const out = importConfigFromEnv(ENV, '2026-01-01T00:00:00Z');
    expect(out).not.toBeNull();
    expect(Object.keys(out!.config).sort()).toEqual(['datacenter', 'network']);
    expect(out!.config.datacenter).toEqual({
      enabled: true,
      vendor: 'proxmox',
      secretSource: 'env',
      config: {
        baseUrl: 'https://pve.example.test',
        tokenId: 'root@pam!tok',
        node: 'pve1',
      },
    });
    expect(JSON.stringify(out)).not.toContain('super-secret');
    expect(out!.onboarding).toEqual({ complete: true, completedAt: '2026-01-01T00:00:00Z' });
  });

  it('returns null when nothing is enabled', () => {
    expect(importConfigFromEnv({}, '2026-01-01T00:00:00Z')).toBeNull();
  });
});

describe('importEnvConfigIfEmpty', () => {
  it('seeds the store once and does not clobber later edits', async () => {
    await importEnvConfigIfEmpty(store, ENV, '2026-01-01T00:00:00Z');
    expect((await getStatus(store)).onboardingComplete).toBe(true);

    await upsertSelection(store, {
      capability: 'datacenter',
      vendor: 'proxmox',
      config: { node: 'pve2' },
    });
    await importEnvConfigIfEmpty(store, ENV, '2030-01-01T00:00:00Z');

    const cfg = (await store.get(CONFIG_KEY))?.value as IntegrationConfig;
    expect(cfg.datacenter.config.node).toBe('pve2');
    // env-sourced: the secret is never copied into the store
    expect(cfg.datacenter.secretSource).toBe('env');
    expect(cfg.datacenter.config.tokenSecret).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toContain('super-secret');
  });

  it('leaves the store empty and onboarding incomplete with no env', async () => {
    await importEnvConfigIfEmpty(store, {}, '2026-01-01T00:00:00Z');
    expect(await getStatus(store)).toEqual({
      onboardingComplete: false,
      configuredCapabilities: [],
    });
  });
});

describe('upsertSelection (db mode, encrypted at rest)', () => {
  it('stores a secret as an encrypted blob and resolves it back to plaintext', async () => {
    await upsertSelection(store, {
      capability: 'network',
      vendor: 'unifi',
      config: { baseUrl: 'https://unifi.example.test', apiKey: 'unifi-key' },
    });

    const cfg = (await store.get(CONFIG_KEY))?.value as IntegrationConfig;
    expect(cfg.network.secretSource).toBe('db');
    const stored = cfg.network.config.apiKey as { v?: number; ct?: string };
    expect(stored.v).toBe(1);
    expect(typeof stored.ct).toBe('string');
    expect(JSON.stringify(cfg)).not.toContain('unifi-key');

    expect((await readSelectionConfig(store, 'network')).apiKey).toBe('unifi-key');
  });

  it('keeps the stored secret when re-saved with a blank value', async () => {
    await upsertSelection(store, {
      capability: 'network',
      vendor: 'unifi',
      config: { baseUrl: 'https://unifi.example.test', apiKey: 'unifi-key' },
    });
    await upsertSelection(store, {
      capability: 'network',
      vendor: 'unifi',
      config: { baseUrl: 'https://unifi.example.test', apiKey: '' },
    });
    expect((await readSelectionConfig(store, 'network')).apiKey).toBe('unifi-key');
  });

  it('does not store a secret in env mode and resolves it from the environment', async () => {
    vi.stubEnv('UNIFI_API_KEY', 'env-key');
    await upsertSelection(store, {
      capability: 'network',
      vendor: 'unifi',
      secretSource: 'env',
      config: { baseUrl: 'https://unifi.example.test' },
    });

    const cfg = (await store.get(CONFIG_KEY))?.value as IntegrationConfig;
    expect(cfg.network.secretSource).toBe('env');
    expect(cfg.network.config.apiKey).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toContain('env-key');

    expect((await readSelectionConfig(store, 'network')).apiKey).toBe('env-key');
  });
});

describe('upsertSelection secret + host-change guard', () => {
  it('requires omitted secrets to be re-supplied when the base URL host changes', async () => {
    await upsertSelection(store, {
      capability: 'datacenter',
      vendor: 'proxmox',
      config: {
        baseUrl: 'https://pve.example.test',
        tokenId: 'root@pam!tok',
        tokenSecret: 'super-secret',
        node: 'pve1',
      },
    });

    // Same host, secret omitted: the stored secret is kept (blank-to-keep UX).
    await upsertSelection(store, {
      capability: 'datacenter',
      vendor: 'proxmox',
      config: { baseUrl: 'https://pve.example.test', tokenId: 'root@pam!tok', node: 'pve1' },
    });
    expect((await readSelectionConfig(store, 'datacenter')).tokenSecret).toBe('super-secret');

    // Different host, secret omitted: rejected.
    await expect(
      upsertSelection(store, {
        capability: 'datacenter',
        vendor: 'proxmox',
        config: { baseUrl: 'https://attacker.example.test', tokenId: 'root@pam!tok', node: 'pve1' },
      }),
    ).rejects.toThrow(/base URL/);

    // Different host with the secret supplied: allowed.
    await upsertSelection(store, {
      capability: 'datacenter',
      vendor: 'proxmox',
      config: {
        baseUrl: 'https://new.example.test',
        tokenId: 'root@pam!tok',
        tokenSecret: 'fresh-secret',
        node: 'pve1',
      },
    });
    expect((await readSelectionConfig(store, 'datacenter')).tokenSecret).toBe('fresh-secret');
  });

  it('rejects unknown capability / vendor and missing required fields', async () => {
    await expect(upsertSelection(store, { capability: 'nope', vendor: 'x' })).rejects.toThrow();

    await expect(
      upsertSelection(store, { capability: 'datacenter', vendor: 'vmware' }),
    ).rejects.toThrow(/not available/);
    await expect(
      upsertSelection(store, {
        capability: 'datacenter',
        vendor: 'proxmox',
        config: { baseUrl: 'x' },
      }),
    ).rejects.toThrow(/required/);
  });

  it('rejects a base URL pointing at the link-local/metadata range', async () => {
    await expect(
      upsertSelection(store, {
        capability: 'datacenter',
        vendor: 'proxmox',
        config: {
          baseUrl: 'http://169.254.169.254',
          tokenId: 'id',
          tokenSecret: 's',
          node: 'pve1',
        },
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it('rejects select values outside the declared options', async () => {
    await expect(
      upsertSelection(store, { capability: 'gpu', vendor: 'nvidia', config: { mode: 'evil' } }),
    ).rejects.toThrow(/expected one of/);
  });

  it('rejects an unsafe ssh host', async () => {
    await expect(
      upsertSelection(store, {
        capability: 'gpu',
        vendor: 'nvidia',
        config: { mode: 'ssh', sshHost: '203.0.113.5 -oProxyCommand=evil' },
      }),
    ).rejects.toThrow(/invalid host/);
  });
});

describe('getRedactedConfig', () => {
  it('never exposes a stored (encrypted) secret, only its presence', async () => {
    await upsertSelection(store, {
      capability: 'network',
      vendor: 'unifi',
      config: { baseUrl: 'https://unifi.example.test', apiKey: 'unifi-key' },
    });
    const view = await getRedactedConfig(store);
    const net = view.capabilities.network as {
      config: Record<string, unknown>;
      secrets: Record<string, boolean>;
      secretSource: string;
    };
    expect(net.config).toMatchObject({ baseUrl: 'https://unifi.example.test' });
    expect(net.config).not.toHaveProperty('apiKey');
    expect(net.secrets).toEqual({ apiKey: true });
    expect(net.secretSource).toBe('db');
    expect(JSON.stringify(view)).not.toContain('unifi-key');
  });

  it('reports an env-sourced secret as set based on the environment', async () => {
    vi.stubEnv('PROXMOX_TOKEN_SECRET', 'super-secret');
    await importEnvConfigIfEmpty(store, ENV, '2026-01-01T00:00:00Z');
    const view = await getRedactedConfig(store);
    const dc = view.capabilities.datacenter as {
      config: Record<string, unknown>;
      secrets: Record<string, boolean>;
      secretSource: string;
    };
    expect(dc.secretSource).toBe('env');
    expect(dc.config).not.toHaveProperty('tokenSecret');
    expect(dc.secrets).toEqual({ tokenSecret: true });
    expect(JSON.stringify(view)).not.toContain('super-secret');
  });
});

describe('migrateSecretsAtRest', () => {
  it('encrypts legacy plaintext secrets left by an older version', async () => {
    // Simulate a pre-encryption store: a plaintext secret written directly.
    await store.put(CONFIG_KEY, {
      network: {
        enabled: true,
        vendor: 'unifi',
        config: { baseUrl: 'https://unifi.example.test', apiKey: 'legacy-plain' },
      },
    });

    await migrateSecretsAtRest(store);

    const cfg = (await store.get(CONFIG_KEY))?.value as IntegrationConfig;
    expect((cfg.network.config.apiKey as { v?: number }).v).toBe(1);
    expect(JSON.stringify(cfg)).not.toContain('legacy-plain');
    expect((await readSelectionConfig(store, 'network')).apiKey).toBe('legacy-plain');
  });
});

describe('resolveSecrets failure handling', () => {
  it('drops a secret that cannot be decrypted instead of throwing', async () => {
    await upsertSelection(store, {
      capability: 'network',
      vendor: 'unifi',
      config: { baseUrl: 'https://unifi.example.test', apiKey: 'unifi-key' },
    });

    // A different key: the stored blob can no longer be decrypted.
    vi.stubEnv('APP_ENCRYPTION_KEY', 'b'.repeat(64));
    resetSecretKeyCache();

    const resolved = await readSelectionConfig(store, 'network');
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.baseUrl).toBe('https://unifi.example.test');
  });
});
