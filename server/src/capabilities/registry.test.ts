import { describe, expect, it } from 'vitest';

import { availableProviders, CAPABILITIES, type CapabilityId } from './registry.js';

const EXPECTED_CAPABILITIES: CapabilityId[] = [
  'datacenter',
  'network',
  'nas',
  'cameras',
  'containers',
  'gpu',
  'sensors',
  'logs',
];

describe('capability registry', () => {
  it('defines every expected capability with a unique id', () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...EXPECTED_CAPABILITIES].sort());
  });

  it('gives every capability at least one available provider', () => {
    for (const cap of CAPABILITIES) {
      const available = cap.providers.filter((p) => p.status === 'available');
      expect(available.length, `${cap.id} has an available provider`).toBeGreaterThanOrEqual(1);
    }
  });

  it('uses unique adapter keys across available providers', () => {
    const adapters = availableProviders().map(({ provider }) => provider.adapter);
    expect(new Set(adapters).size).toBe(adapters.length);
  });

  it('keeps provider ids unique within each capability', () => {
    for (const cap of CAPABILITIES) {
      const ids = cap.providers.map((p) => p.id);
      expect(new Set(ids).size, `${cap.id} provider ids unique`).toBe(ids.length);
    }
  });

  it('marks secret fields and never carries a value', () => {
    for (const { provider } of availableProviders()) {
      for (const field of provider.configSchema) {
        expect(field).not.toHaveProperty('value');
        if (field.type === 'password') expect(field.secret).toBe(true);
      }
    }
  });
});
