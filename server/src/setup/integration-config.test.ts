import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStateDb } from '../state/db.js';
import type { StateStore } from '../storage/types.js';
import {
  CONFIG_KEY,
  getRedactedConfig,
  getStatus,
  importConfigFromEnv,
  importEnvConfigIfEmpty,
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
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-cfg-test-'));
  store = await openStateDb(path.join(tempDir, 'state.sqlite'));
});
afterEach(async () => {
  await store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe('importConfigFromEnv', () => {
  it('builds selections only for enabled capabilities, deriving config from env', () => {
    const out = importConfigFromEnv(ENV, '2026-01-01T00:00:00Z');
    expect(out).not.toBeNull();
    expect(Object.keys(out!.config).sort()).toEqual(['datacenter', 'network']);
    expect(out!.config.datacenter).toEqual({
      enabled: true,
      vendor: 'proxmox',
      config: {
        baseUrl: 'https://pve.example.test',
        tokenId: 'root@pam!tok',
        tokenSecret: 'super-secret',
        node: 'pve1',
      },
    });
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

    expect(cfg.datacenter.config.tokenSecret).toBe('super-secret');
  });

  it('leaves the store empty and onboarding incomplete with no env', async () => {
    await importEnvConfigIfEmpty(store, {}, '2026-01-01T00:00:00Z');
    expect(await getStatus(store)).toEqual({
      onboardingComplete: false,
      configuredCapabilities: [],
    });
  });
});

describe('getRedactedConfig', () => {
  it('replaces secret values with presence markers', async () => {
    await importEnvConfigIfEmpty(store, ENV, '2026-01-01T00:00:00Z');
    const view = await getRedactedConfig(store);
    const dc = view.capabilities.datacenter as {
      config: Record<string, unknown>;
      secrets: Record<string, boolean>;
    };
    expect(dc.config).toMatchObject({ baseUrl: 'https://pve.example.test', node: 'pve1' });
    expect(dc.config).not.toHaveProperty('tokenSecret');
    expect(dc.secrets).toEqual({ tokenSecret: true });
    expect(JSON.stringify(view)).not.toContain('super-secret');
  });
});

describe('upsertSelection', () => {
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

  it('requires omitted secrets to be re-supplied when the base URL host changes', async () => {
    await importEnvConfigIfEmpty(store, ENV, '2026-01-01T00:00:00Z');

    // Same host, secret omitted: the stored secret is kept (the blank-to-keep UX).
    await upsertSelection(store, {
      capability: 'datacenter',
      vendor: 'proxmox',
      config: { baseUrl: 'https://pve.example.test', tokenId: 'root@pam!tok', node: 'pve1' },
    });
    let cfg = (await store.get(CONFIG_KEY))?.value as IntegrationConfig;
    expect(cfg.datacenter.config.tokenSecret).toBe('super-secret');

    // Different host, secret omitted: rejected — never send the stored secret elsewhere.
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
    cfg = (await store.get(CONFIG_KEY))?.value as IntegrationConfig;
    expect(cfg.datacenter.config.tokenSecret).toBe('fresh-secret');
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
        config: { mode: 'ssh', sshHost: '10.0.0.5 -oProxyCommand=evil' },
      }),
    ).rejects.toThrow(/invalid host/);
  });
});
