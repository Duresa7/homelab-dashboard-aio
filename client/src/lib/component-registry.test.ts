import { describe, expect, it } from 'vitest';

import {
  COMPONENT_BLOCKS,
  COMPONENT_TYPE_FIELDS,
  COMPONENT_TYPE_LABELS,
  COMPONENT_TYPE_ORDER,
  COMPONENT_TYPE_REGISTRY,
  detectComponentType,
} from './component-registry';

describe('component type registry', () => {
  it('derives compatibility maps from the registry source of truth', () => {
    expect(Object.keys(COMPONENT_TYPE_REGISTRY).sort()).toEqual([...COMPONENT_TYPE_ORDER].sort());

    for (const type of COMPONENT_TYPE_ORDER) {
      const definition = COMPONENT_TYPE_REGISTRY[type];

      expect(COMPONENT_BLOCKS[type]).toBe(definition.block);
      expect(COMPONENT_TYPE_FIELDS[type]).toBe(definition.fields);
      expect(COMPONENT_TYPE_LABELS[type]).toBe(definition.label);
      expect(definition.fields.length).toBeGreaterThan(0);
    }
  });

  it('preserves component type detection precedence', () => {
    expect(detectComponentType('CPU Cooler')).toBe('cooler');
    expect(detectComponentType('Thermal Paste', 'Thermal Grizzly Kryonaut')).toBe('cooler');
    expect(detectComponentType('Drive Bay 2')).toBe('storage');
    expect(detectComponentType('NIC 2')).toBe('nic');
    expect(detectComponentType('Mystery part')).toBe('other');
  });
});
