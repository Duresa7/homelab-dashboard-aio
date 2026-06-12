export type ComponentType =
  | 'cpu'
  | 'gpu'
  | 'motherboard'
  | 'ram'
  | 'storage'
  | 'psu'
  | 'cooler'
  | 'case'
  | 'nic'
  | 'other';

export interface ComponentTypeDefinition {
  block: number;
  label: string;
  fields: string[];
  detect: RegExp;
}

export const COMPONENT_TYPE_ORDER: ComponentType[] = [
  'cooler',
  'cpu',
  'gpu',
  'motherboard',
  'ram',
  'storage',
  'psu',
  'case',
  'nic',
  'other',
];

export const COMPONENT_TYPE_REGISTRY: Record<ComponentType, ComponentTypeDefinition> = {
  cpu: {
    block: 1000,
    label: 'CPU',
    fields: ['Brand', 'Model', 'Cores', 'Threads', 'Socket', 'TDP'],
    detect: /\bcpus?\b|processor/,
  },
  gpu: {
    block: 2000,
    label: 'GPU',
    fields: ['Brand', 'Model', 'VRAM', 'Interface'],
    detect: /\bgpus?\b|graphics|geforce|radeon|video\s*card/,
  },
  motherboard: {
    block: 3000,
    label: 'Motherboard',
    fields: ['Brand', 'Model', 'Socket', 'Chipset', 'Form Factor'],
    detect: /motherboards?|mainboards?|\bmobo\b/,
  },
  ram: {
    block: 4000,
    label: 'RAM',
    fields: ['Brand', 'Model', 'Type', 'Speed', 'Capacity', 'Timing', 'Voltage', 'Profile'],
    detect: /\bram\b|memory|dimm|dram/,
  },
  storage: {
    block: 5000,
    label: 'Storage',
    fields: ['Brand', 'Model', 'Capacity', 'Form Factor', 'Interface'],
    detect: /storage|drive\s*bay|\bssds?\b|\bhdds?\b|\bnvme\b|m\.2|hard\s*drives?/,
  },
  psu: {
    block: 6000,
    label: 'PSU',
    fields: ['Brand', 'Model', 'Wattage', 'Rating', 'Modular'],
    detect: /\bpsus?\b|power\s*supply|power supplies/,
  },
  cooler: {
    block: 7000,
    label: 'Cooler',
    fields: ['Brand', 'Model', 'Type', 'Size'],
    detect: /coolers?|\baio\b|heatsink|radiator|\bfans?\b|thermal\s*paste|\bpaste\b/,
  },
  case: {
    block: 8000,
    label: 'Case',
    fields: ['Brand', 'Model', 'Form Factor'],
    detect: /\bcase\b|chassis|tower/,
  },
  nic: {
    block: 9000,
    label: 'NIC',
    fields: ['Brand', 'Model', 'Speed', 'Interface'],
    detect: /\bnics?\b|ethernet|\blan\b|network\s*card/,
  },
  other: {
    block: 10000,
    label: 'Other',
    fields: ['Brand', 'Model'],
    detect: /.*/,
  },
};

export const COMPONENT_BLOCKS = Object.fromEntries(
  Object.entries(COMPONENT_TYPE_REGISTRY).map(([type, definition]) => [type, definition.block]),
) as Record<ComponentType, number>;

export const COMPONENT_TYPE_FIELDS = Object.fromEntries(
  Object.entries(COMPONENT_TYPE_REGISTRY).map(([type, definition]) => [type, definition.fields]),
) as Record<ComponentType, string[]>;

export const COMPONENT_TYPE_LABELS = Object.fromEntries(
  Object.entries(COMPONENT_TYPE_REGISTRY).map(([type, definition]) => [type, definition.label]),
) as Record<ComponentType, string>;

export function detectComponentType(label: string, spec = ''): ComponentType {
  const key = `${label} ${spec}`.toLowerCase();
  for (const type of COMPONENT_TYPE_ORDER) {
    if (type === 'other') continue;
    if (COMPONENT_TYPE_REGISTRY[type].detect.test(key)) return type;
  }
  return 'other';
}
