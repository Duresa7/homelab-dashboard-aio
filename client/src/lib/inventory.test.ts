import { afterEach, describe, expect, it, vi } from 'vitest';

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

function v6Fixture() {
  return {
    lastUpdated: '2026-05-30',
    machines: [
      {
        id: 'mach_workstation',
        ordinal: '01',
        name: 'Workstation 1',
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
              model: 'UCG-X (Example Gateway)',
            },
          },
          {
            id: 's_flex',
            values: {
              role: 'Switch',
              brand: 'Ubiquiti',
              model: 'USW-FX-X (Flex 2.5G 5-port)',
              qty: '2',
            },
          },
          {
            id: 's_cam',
            values: {
              role: 'Camera',
              brand: 'Ubiquiti',
              model: 'UVC-X (Protect G6 Bullet)',
            },
          },
        ],
      },
      {
        id: 'cat_legacy',
        name: 'Networking',
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
    const cpu = inv.components.find((c) => c.type === 'cpu' && c.assignment === 'mach_workstation');
    expect(cpu?.ids?.uid).toBe('1001');
    expect(cpu?.rawSpec).toContain('Ryzen 9 9950X3D');
    expect(fieldValue(cpu!.fields, 'Cores')).toBe('16');

    const gpu = inv.components.find((c) => c.type === 'gpu');
    expect(gpu?.ids?.uid).toBe('2001');
    expect(gpu?.assignment).toBe('mach_workstation');
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

    expect(inv.devices.some((c) => /cpus?/i.test(c.name))).toBe(false);
  });

  it('keeps active network gear as a device category, renames it generically, marks it in-service', () => {
    const net = inv.devices.find((c) => c.name === 'Network');
    expect(net?.deviceType).toBe('network');
    expect(net?.prefix).toBe('04');
    expect(net?.name).not.toMatch(/unifi/i);
    const ucg = net?.items.find((it) => /UCG-X/.test(it.values.model));
    expect(ucg?.name).toBe('Gateway');
    expect(ucg?.deployment).toBe('in-service');
    expect(ucg?.ids?.uid?.startsWith('04')).toBe(true);
  });

  it('marks non-active networking gear as spare, not in-service', () => {
    const networking = inv.devices.find((c) => c.name === 'Networking');
    expect(networking).toBeTruthy();
    expect(networking?.name).not.toMatch(/legacy/i);
    expect(networking?.note).toBeUndefined();
    expect(networking?.items.every((it) => it.deployment === 'spare')).toBe(true);
  });

  it('normalizes old legacy networking labels and category notes', () => {
    const old = v6Fixture();
    const oldNetworking = old.spares[2] as Record<string, unknown>;
    oldNetworking.name = 'Networking (legacy)';
    oldNetworking.note = 'Earlier networking gear retained as spares.';

    const migrated = migrateInventory(old as never);
    const networking = migrated.devices.find((c) => c.id === 'cat_legacy');

    expect(networking?.name).toBe('Networking');
    expect(networking?.note).toBeUndefined();
    expect(networking?.items[0].values).toEqual({ brand: 'Netgear', model: 'GS308' });
  });

  it('splits the qty-2 USW-FX into two separately-named switches', () => {
    const net = inv.devices.find((c) => c.name === 'Network')!;
    const flex = net.items.filter((it) => /USW-FX/.test(it.values.model));
    expect(flex).toHaveLength(2);
    expect(flex.map((it) => it.name).sort()).toEqual(['Access Switch 1', 'Access Switch 2']);
    expect(flex.every((it) => it.values.qty === '1')).toBe(true);
    expect(new Set(flex.map((it) => it.ids?.uid)).size).toBe(2);
  });

  it('repairs already-v7 inventories that still have a qty-2 USW-FX row', () => {
    const inv7 = {
      lastUpdated: '2026-06-01',
      machines: [],
      components: [],
      devices: [
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
              values: { model: 'UCG-X (Example Gateway)', qty: '1' },
              name: 'Gateway',
              ids: { uid: '0401' },
            },
            {
              id: 's_flex',
              deployment: 'in-service' as const,
              values: { model: 'USW-FX-X (Flex 2.5G 5-port)', qty: '2' },
              ids: { uid: '0402' },
            },
            {
              id: 's_core_switch',
              deployment: 'in-service' as const,
              values: { model: 'USW-PM-X (Pro Max 16 PoE)', qty: '1' },
              name: 'PoE Switch',
              ids: { uid: '0403' },
            },
          ],
        },
      ],
    };

    const repaired = migrateInventory(inv7);
    const net = repaired.devices[0];
    const flex = net.items.filter((it) => /USW-FX/.test(it.values.model));
    expect(flex).toHaveLength(2);
    expect(flex.map((it) => it.name)).toEqual(['Access Switch 1', 'Access Switch 2']);
    expect(flex.map((it) => it.values.qty)).toEqual(['1', '1']);
    expect(flex.map((it) => it.ids?.uid)).toEqual(['0402', '0403']);
    expect(net.items.find((it) => it.id === 's_core_switch')?.ids?.uid).toBe('0404');
  });

  it('reclassifies the UVC camera out of the network category into Cameras', () => {
    const cams = inv.devices.find((c) => c.deviceType === 'camera');
    expect(cams).toBeTruthy();
    const cam = cams?.items[0];
    expect(cam?.ids?.uid?.startsWith('07')).toBe(true);
    expect(cam?.name).toBe('Camera 1');
  });

  it('records an old→new UID map', () => {
    const map = getLastUidMap();
    expect(map.length).toBeGreaterThan(0);
    expect(map.some((e) => e.new === '0801')).toBe(true);
  });
});

describe('migrateInventory (spares → devices)', () => {
  it('maps an already-flat persisted spares array to devices without losing item data', () => {
    const legacy = {
      lastUpdated: '2026-06-05',
      machines: [],
      components: [],
      spares: [
        {
          id: 'cat_net',
          name: 'Network',
          deviceType: 'network' as const,
          prefix: '04',
          columns: [{ id: 'model', label: 'Model' }],
          items: [
            {
              id: 'dev_gateway',
              name: 'Gateway',
              deployment: 'in-service' as const,
              values: { model: 'UCG-X' },
              ids: { uid: '0401' },
              status: 'working' as const,
            },
          ],
        },
      ],
    };

    const migrated = migrateInventory(legacy as never);

    expect((migrated as unknown as Record<string, unknown>).spares).toBeUndefined();
    expect(migrated.devices).toHaveLength(1);
    expect(migrated.devices[0].id).toBe('cat_net');
    expect(migrated.devices[0].items[0]).toMatchObject({
      id: 'dev_gateway',
      name: 'Gateway',
      deployment: 'in-service',
      values: { model: 'UCG-X' },
      ids: { uid: '0401' },
      status: 'working',
    });
  });
});

describe('migrateInventory (v9 → v10 images)', () => {
  it('defaults images to [] on every item type and preserves existing refs', () => {
    const v9 = {
      lastUpdated: '2026-06-09',
      machines: [
        { id: 'm1', name: 'Tower', role: 'compute', deployment: 'in-service' as const, meta: [] },
      ],
      components: [
        {
          id: 'c1',
          type: 'gpu' as const,
          label: 'GPU',
          fields: [],
          assignment: 'm1',
          images: [{ id: 'aaaaaaaaaaaaaaaa', w: 320, h: 200 }],
        },
      ],
      devices: [
        {
          id: 'cat_net',
          name: 'Network',
          deviceType: 'network' as const,
          prefix: '04',
          columns: [],
          items: [
            {
              id: 'd1',
              name: 'Gateway',
              deployment: 'in-service' as const,
              values: {},
              ids: { uid: '0401' },
            },
          ],
        },
      ],
    };

    const migrated = migrateInventory(v9 as never);
    expect(migrated.machines[0].images).toEqual([]);
    expect(migrated.devices[0].items[0].images).toEqual([]);

    expect(migrated.components[0].images).toEqual([{ id: 'aaaaaaaaaaaaaaaa', w: 320, h: 200 }]);
  });
});

describe('empty inventory defaults', () => {
  it('resets to an empty inventory shape', () => {
    const fresh = resetInventory();
    expect(fresh).toEqual({ lastUpdated: '', machines: [], components: [], devices: [] });
    expect(summarize(fresh)).toEqual({
      machineCount: 0,
      componentCount: 0,
      installedComponentCount: 0,
      spareComponentCount: 0,
      deviceCategoryCount: 0,
      deviceItemCount: 0,
      networkItemCount: 0,
    });
  });
});

describe('loadInventory persistence gating', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./store');
    vi.doUnmock('./connectivity');
  });

  async function loadInventoryWith({
    degraded,
    status,
    persisted = null,
  }: {
    degraded: boolean;
    status: 'online' | 'offline' | 'unknown';
    persisted?: unknown;
  }) {
    vi.resetModules();
    const setState = vi.fn();
    vi.doMock('./store', () => ({
      getState: vi.fn(() => persisted),
      setState,
      isDegraded: vi.fn(() => degraded),
    }));
    vi.doMock('./connectivity', () => ({
      getConnectivity: vi.fn(() => ({ status, reason: null, code: null, lastChecked: null })),
    }));
    const mod = await import('./inventory');
    return { loadInventory: mod.loadInventory, setState };
  }

  it('returns an empty shape without seeding after boot hydrate failed', async () => {
    const { loadInventory, setState } = await loadInventoryWith({
      degraded: true,
      status: 'unknown',
    });

    const inv = loadInventory();

    expect(inv).toEqual({ lastUpdated: '', machines: [], components: [], devices: [] });
    expect(setState).not.toHaveBeenCalled();
  });

  it('returns an empty shape without seeding while the backend is offline', async () => {
    const { loadInventory, setState } = await loadInventoryWith({
      degraded: false,
      status: 'offline',
    });

    const inv = loadInventory();

    expect(inv).toEqual({ lastUpdated: '', machines: [], components: [], devices: [] });
    expect(setState).not.toHaveBeenCalled();
  });

  it('returns an empty shape without seeding on an online first boot', async () => {
    const { loadInventory, setState } = await loadInventoryWith({
      degraded: false,
      status: 'online',
    });

    const inv = loadInventory();

    expect(inv).toEqual({ lastUpdated: '', machines: [], components: [], devices: [] });
    expect(setState).not.toHaveBeenCalled();
  });
});
