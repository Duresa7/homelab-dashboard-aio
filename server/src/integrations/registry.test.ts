import { describe, expect, it, vi } from 'vitest';

import { baseIntegrationProviders, createProviderCatalog } from './registry.js';
import type { RuntimeProvider } from './provider.js';

function runtimeProvider(id: string, capabilityId: string): RuntimeProvider {
  return {
    id,
    capabilityId,
    logName: id,
    status: () => ({ enabled: true, configured: true }),
    configure: vi.fn(),
    notConfiguredMessage: `${id} not configured`,
  };
}

describe('provider catalog', () => {
  it('includes the built-in integration providers', () => {
    const catalog = createProviderCatalog();

    expect(catalog.providers).toEqual(baseIntegrationProviders);
    expect(catalog.providerByCapabilityId.get('datacenter')?.id).toBe('proxmox');
    expect(catalog.providerByCapabilityId.get('network')?.id).toBe('unifi');
    expect(catalog.providerByCapabilityId.get('containers')?.id).toBe('docker');
    expect(catalog.providerByCapabilityId.get('nas')?.id).toBe('unas');
    expect(catalog.providerByCapabilityId.get('gpu')?.id).toBe('gpu');
  });

  it('attaches runtime providers to the same lookup maps', () => {
    const sensors = runtimeProvider('sensors', 'sensors');
    const siem = runtimeProvider('siem', 'logs');
    const catalog = createProviderCatalog([sensors, siem]);

    expect(catalog.providerByCapabilityId.get('sensors')).toBe(sensors);
    expect(catalog.providerByCapabilityId.get('logs')).toBe(siem);
    expect(catalog.providerById.get('sensors')).toBe(sensors);
    expect(catalog.providerById.get('siem')).toBe(siem);
  });
});
