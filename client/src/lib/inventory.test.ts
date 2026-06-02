import { describe, it, expect } from 'vitest';

import {
  COMPONENT_BLOCKS,
  detectComponentType,
  detectDeviceType,
  migrateInventory,
  nextComponentUid,
  nextDeviceUid,
  parseSpecToFields,
  resetInventory,
  splitMultiUnit,
  summarize,
  fieldValue,
  getLastUidMap,
  SPARE,
  type Component,
} from './inventory';

/* A representative v6-shaped inventory (machines embed components; spares mix
   component categories with device categories) for migration tests. */
function v6Fixture() {
  return {
    lastUpdated: '2026-05-30',
    machines: [
      {
        id: 'mach_example',
        ordinal: '01',
        name: 'Example PC',
        role: 'Windows workstation',
        meta: [{ id: 'm1', label: 'IP', value: '198.51.100.10' }],
        components: [
          { id: 'c_cpu', component: 'CPU', specification: 'AMD Ryzen 9 9950X3D — 16C / 32T, AM5' },
          {
            id: 'c_gpu',
            component: 'GPU',
            specification: 'MSI Inspire 3X OC GeForce RTX 5070 Ti — 16 GB',
            status: 'working' as const,
          },
          {
            id: 'c_ram',
            component: 'RAM',
            specification:
              'G.SKILL Trident Z5 Neo RGB — DDR5-6000 32 GB (2×16 GB), CL30, 1.35 V, AMD EXPO',
          },
        ],
      },
    ],
    spares: [
      {
        id: 'cat_cpus',
        name: 'CPUs',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          {
            id: 's_cpu',
            values: { brand: 'Intel', model: 'Core i7-5820K', notes: '6-core, LGA 2011-v3' },
          },
        ],
      },
      {
        id: 'cat_net',
        name: 'UniFi Network Infrastructure',
        kind: 'network',
        columns: [
          { id: 'role', label: 'Role' },
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
        ],
        items: [
          {
            id: 's_ucg',
            values: {
              role: 'Gateway',
              brand: 'Ubiquiti',
              model: 'UCG-Fiber (UniFi Cloud Gateway Fiber)',
            },
          },
          {
            id: 's_flex',
            values: {
              role: 'Switch',
              brand: 'Ubiquiti',
              model: 'USW-Flex-2.5G-5 (Flex 2.5G 5-port)',
              qty: '2',
            },
          },
          {
            id: 's_cam',
            values: {
              role: 'Camera',
              brand: 'Ubiquiti',
              model: 'UVC-G6-Bullet (Protect G6 Bullet)',
            },
          },
        ],
      },
      {
        id: 'cat_legacy',
        name: 'Networking (legacy)',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
        ],
        items: [{ id: 's_legacy', values: { brand: 'Netgear', model: 'GS308' } }],
      },
    ],
  };
}

describe('UID engine', () => {
  it('assigns sequential component UIDs within a type block', () => {
    const existing: Component[] = [
      { id: 'a', type: 'gpu', label: 'GPU', fields: [], assignment: SPARE, ids: { uid: '2001' } },
    ];
    expect(nextComponentUid('gpu', existing)).toBe('2002');
    expect(nextComponentUid('cpu', existing)).toBe('1001');
    expect(COMPONENT_BLOCKS.gpu).toBe(2000);
  });

  it('assigns sequential device UIDs within a prefix block', () => {
    expect(nextDeviceUid('04', ['0401', '0402'])).toBe('0403');
    expect(nextDeviceUid('01', [])).toBe('0101');
    expect(nextDeviceUid('07', ['0401'])).toBe('0701');
  });
});

describe('type detection', () => {
  it('maps free-text labels to canonical component types', () => {
    expect(detectComponentType('Drive Bay 2')).toBe('storage');
    expect(detectComponentType('NVMe Slot 1')).toBe('storage');
    expect(detectComponentType('RAM (DIMM1)')).toBe('ram');
    expect(detectComponentType('CPU Cooler')).toBe('cooler');
    expect(detectComponentType('Thermal Paste', 'Thermal Grizzly Kryonaut')).toBe('cooler');
    expect(detectComponentType('NIC 2')).toBe('nic');
  });

  it('maps category names to device types', () => {
    expect(detectDeviceType('Laptops')).toBe('laptop');
    expect(detectDeviceType('UniFi Network Infrastructure')).toBe('network');
    expect(detectDeviceType('Cameras')).toBe('camera');
    expect(detectDeviceType('Printers')).toBe('printer');
  });
});

describe('splitMultiUnit', () => {
  it('detects N× capacity', () => {
    expect(splitMultiUnit('… 32 GB (2×16 GB), CL30')).toEqual({ count: 2, perUnit: '16 GB' });
    expect(splitMultiUnit('… 64 GB (4×16 GB)')).toEqual({ count: 4, perUnit: '16 GB' });
    expect(splitMultiUnit('2 TB NVMe')).toEqual({ count: 1 });
  });
});

describe('parseSpecToFields', () => {
  it('parses a CPU spec into labeled fields', () => {
    const f = parseSpecToFields('cpu', 'AMD Ryzen 9 9950X3D — 16C / 32T, AM5');
    expect(fieldValue(f, 'Brand')).toBe('AMD');
    expect(fieldValue(f, 'Model')).toBe('Ryzen 9 9950X3D');
    expect(fieldValue(f, 'Cores')).toBe('16');
    expect(fieldValue(f, 'Threads')).toBe('32');
    expect(fieldValue(f, 'Socket')).toBe('AM5');
  });

  it('parses a RAM spec into labeled fields', () => {
    const f = parseSpecToFields(
      'ram',
      'G.SKILL Trident Z5 Neo RGB — DDR5-6000 32 GB (2×16 GB), CL30, 1.35 V, AMD EXPO',
    );
    expect(fieldValue(f, 'Brand')).toBe('G.SKILL');
    expect(fieldValue(f, 'Type')).toBe('DDR5');
    expect(fieldValue(f, 'Speed')).toBe('6000 MT/s');
    expect(fieldValue(f, 'Capacity')).toBe('32 GB');
    expect(fieldValue(f, 'Timing')).toBe('CL30');
    expect(fieldValue(f, 'Voltage')).toBe('1.35 V');
    expect(fieldValue(f, 'Profile')).toBe('AMD EXPO');
  });

  it('parses a storage spec', () => {
    const f = parseSpecToFields('storage', 'Samsung 990 Pro — 2 TB NVMe M.2');
    expect(fieldValue(f, 'Capacity')).toBe('2 TB');
    expect(fieldValue(f, 'Interface')).toBe('NVMe');
    expect(fieldValue(f, 'Form Factor')).toBe('M.2');
  });
});

describe('migrateInventory (v6 → v7)', () => {
  const inv = migrateInventory(v6Fixture() as never);

  it('renumbers the machine into the 08 block and drops embedded components', () => {
    expect(inv.machines).toHaveLength(1);
    expect(inv.machines[0].ids?.uid).toBe('0801');
    expect(inv.machines[0].deployment).toBe('in-service');
    expect((inv.machines[0] as unknown as Record<string, unknown>).components).toBeUndefined();
  });

  it('moves components into the pool with type-block UIDs and preserves rawSpec', () => {
    const cpu = inv.components.find((c) => c.type === 'cpu' && c.assignment === 'mach_example');
    expect(cpu?.ids?.uid).toBe('1001');
    expect(cpu?.rawSpec).toContain('Ryzen 9 9950X3D');
    expect(fieldValue(cpu!.fields, 'Cores')).toBe('16');

    const gpu = inv.components.find((c) => c.type === 'gpu');
    expect(gpu?.ids?.uid).toBe('2001');
    expect(gpu?.assignment).toBe('mach_example');
  });

  it('splits the 2×16 GB RAM into two stick entries each with their own UID', () => {
    const ram = inv.components.filter((c) => c.type === 'ram');
    expect(ram).toHaveLength(2);
    expect(ram.map((r) => r.label).sort()).toEqual(['RAM 1', 'RAM 2']);
    expect(ram.map((r) => r.ids?.uid).sort()).toEqual(['4001', '4002']);
    for (const r of ram) expect(fieldValue(r.fields, 'Capacity')).toBe('16 GB');
  });

  it('dissolves the spare CPU category into the pool as a spare component', () => {
    const spareCpu = inv.components.find((c) => c.type === 'cpu' && c.assignment === SPARE);
    expect(spareCpu).toBeTruthy();
    expect(spareCpu?.ids?.uid).toBe('1002');
    // No component categories should remain in spares.
    expect(inv.spares.some((c) => /cpus?/i.test(c.name))).toBe(false);
  });

  it('keeps active network gear as a device category, renames it generically, marks it in-service', () => {
    const net = inv.spares.find((c) => c.name === 'Network');
    expect(net?.deviceType).toBe('network');
    expect(net?.prefix).toBe('04');
    expect(net?.name).not.toMatch(/unifi/i);
    const ucg = net?.items.find((it) => /UCG-Fiber/.test(it.values.model));
    expect(ucg?.name).toBe('Gateway Gateway');
    expect(ucg?.deployment).toBe('in-service');
    expect(ucg?.ids?.uid?.startsWith('04')).toBe(true);
  });

  it('marks legacy networking gear as spare, not in-service', () => {
    const legacy = inv.spares.find((c) => /legacy/i.test(c.name));
    expect(legacy).toBeTruthy();
    expect(legacy?.items.every((it) => it.deployment === 'spare')).toBe(true);
  });

  it('splits the qty-2 USW-Flex into two separately-named switches', () => {
    const net = inv.spares.find((c) => c.name === 'Network')!;
    const flex = net.items.filter((it) => /USW-Flex/.test(it.values.model));
    expect(flex).toHaveLength(2);
    expect(flex.map((it) => it.name).sort()).toEqual(['SwitchA-Switch', 'SwitchB-Switch']);
    expect(flex.every((it) => it.values.qty === '1')).toBe(true);
    expect(new Set(flex.map((it) => it.ids?.uid)).size).toBe(2);
  });

  it('repairs already-v7 inventories that still have a qty-2 USW-Flex row', () => {
    const inv7 = {
      lastUpdated: '2026-06-01',
      machines: [],
      components: [],
      spares: [
        {
          id: 'cat_net',
          name: 'Network',
          deviceType: 'network' as const,
          prefix: '04',
          columns: [
            { id: 'model', label: 'Model' },
            { id: 'qty', label: 'Qty' },
          ],
          items: [
            {
              id: 's_ucg',
              deployment: 'in-service' as const,
              values: { model: 'UCG-Fiber (UniFi Cloud Gateway Fiber)', qty: '1' },
              name: 'Gateway Gateway',
              ids: { uid: '0401' },
            },
            {
              id: 's_flex',
              deployment: 'in-service' as const,
              values: { model: 'USW-Flex-2.5G-5 (Flex 2.5G 5-port)', qty: '2' },
              ids: { uid: '0402' },
            },
            {
              id: 's_switch',
              deployment: 'in-service' as const,
              values: { model: 'USW-Pro-Max-16-PoE (Pro Max 16 PoE)', qty: '1' },
              name: 'Switch Switch PoE',
              ids: { uid: '0403' },
            },
          ],
        },
      ],
    };

    const repaired = migrateInventory(inv7);
    const net = repaired.spares[0];
    const flex = net.items.filter((it) => /USW-Flex/.test(it.values.model));
    expect(flex).toHaveLength(2);
    expect(flex.map((it) => it.name)).toEqual(['SwitchA-Switch', 'SwitchB-Switch']);
    expect(flex.map((it) => it.values.qty)).toEqual(['1', '1']);
    expect(flex.map((it) => it.ids?.uid)).toEqual(['0402', '0403']);
    expect(net.items.find((it) => it.id === 's_switch')?.ids?.uid).toBe('0404');
  });

  it('reclassifies the UVC camera out of the network category into Cameras', () => {
    const cams = inv.spares.find((c) => c.deviceType === 'camera');
    expect(cams).toBeTruthy();
    const cam = cams?.items[0];
    expect(cam?.ids?.uid?.startsWith('07')).toBe(true);
    expect(cam?.name).toBe('Outside-Left');
  });

  it('records an old→new UID map', () => {
    const map = getLastUidMap();
    expect(map.length).toBeGreaterThan(0);
    expect(map.some((e) => e.new === '0801')).toBe(true);
  });
});

describe('seed (v7)', () => {
  const seed = resetInventory();

  it('has machines in the 08 block with no embedded components', () => {
    expect(seed.machines.length).toBeGreaterThan(0);
    for (const m of seed.machines) {
      expect(m.ids?.uid?.startsWith('08')).toBe(true);
      expect((m as unknown as Record<string, unknown>).components).toBeUndefined();
    }
  });

  it('splits Example PC RAM into two sticks in the pool', () => {
    const example = seed.machines.find((m) => m.name === 'Example PC')!;
    const ram = seed.components.filter((c) => c.assignment === example.id && c.type === 'ram');
    expect(ram).toHaveLength(2);
  });

  it('gives every component a unique type-block UID', () => {
    const uids = seed.components.map((c) => c.ids?.uid);
    expect(new Set(uids).size).toBe(uids.length);
    const gpus = seed.components.filter((c) => c.type === 'gpu');
    for (const g of gpus) expect(Number(g.ids!.uid)).toBeGreaterThanOrEqual(2000);
  });

  it('names the network devices', () => {
    const net = seed.spares.find((c) => c.deviceType === 'network' && /^network$/i.test(c.name))!;
    const names = net.items.map((it) => it.name);
    expect(names).toContain('Gateway Gateway');
    expect(names).toContain('Switch Switch PoE');
    expect(names).toContain('AccessPoint AP');
  });

  it('summarizes installed vs spare components', () => {
    const s = summarize(seed);
    expect(s.installedComponentCount).toBeGreaterThan(0);
    expect(s.spareComponentCount).toBeGreaterThan(0);
    expect(s.machineCount).toBe(seed.machines.length);
  });
});
