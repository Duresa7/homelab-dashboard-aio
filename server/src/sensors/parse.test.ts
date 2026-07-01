import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { parseSensorsJson, parseDiskInventory, normalizeDiskParts } from './parse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, '__fixtures__', name), 'utf8');

describe('disk model normalization', () => {
  it.each([
    [
      'Seagate IronWolf',
      { model: 'ST4000VN008-2DR166', vendor: 'ATA' },
      { vendor: 'Seagate', model: 'IronWolf 4TB' },
    ],
    [
      'Seagate Exos',
      { model: 'ST8000NM0055', vendor: '' },
      { vendor: 'Seagate', model: 'Exos 8TB' },
    ],
    [
      'Seagate unknown family',
      { model: 'ST6000ZZ001', vendor: '' },
      { vendor: 'Seagate', model: '6TB' },
    ],
    [
      'Western Digital Red Plus',
      { model: 'WD80EFZZ', vendor: 'WDC' },
      { vendor: 'Western Digital', model: 'Red Plus 8TB' },
    ],
    [
      'Western Digital Red heuristic',
      { model: 'WD20EFQQ', vendor: '' },
      { vendor: 'Western Digital', model: 'Red 2TB' },
    ],
    [
      'Crucial SATA SSD',
      { model: 'CT1000MX500SSD1', vendor: '' },
      { vendor: 'Crucial', model: 'MX500 1TB SATA SSD' },
    ],
    [
      'Crucial NVMe SSD',
      { model: 'CT2000P3PSSD8', vendor: '' },
      { vendor: 'Crucial', model: 'P3 Plus 2TB NVMe SSD' },
    ],
    [
      'Samsung',
      { model: 'Samsung SSD 990 PRO 1TB', vendor: 'Samsung' },
      { vendor: 'Samsung', model: '990 PRO 1TB' },
    ],
    [
      'Kingston',
      { model: 'KINGSTON SA400S37240G', vendor: 'Kingston' },
      { vendor: 'Kingston', model: 'SA400S37240G' },
    ],
    [
      'Toshiba',
      { model: 'TOSHIBA MG08ACA16TE', vendor: 'Toshiba' },
      { vendor: 'Toshiba', model: 'MG08ACA16TE' },
    ],
    [
      'Kioxia',
      { model: 'KIOXIA KXG60ZNV256G', vendor: 'Kioxia' },
      { vendor: 'Kioxia', model: 'KXG60ZNV256G' },
    ],
    [
      'HGST',
      { model: 'HGST HUS726T4TALA6L4', vendor: 'HGST' },
      { vendor: 'HGST', model: 'HUS726T4TALA6L4' },
    ],
  ])('recognizes %s disks from upstream model/vendor fields', (_name, disk, expected) => {
    expect(normalizeDiskParts(disk)).toEqual(expected);
  });

  it('drops bus-type vendors and passes unrecognized brands through', () => {
    expect(normalizeDiskParts({ model: 'Generic Model', vendor: 'ata' })).toEqual({
      vendor: '',
      model: 'Generic Model',
    });
    expect(normalizeDiskParts({ model: 'WEIRD BRAND X1', vendor: 'ACME' })).toEqual({
      vendor: 'ACME',
      model: 'WEIRD BRAND X1',
    });
  });

  it('builds display names from normalized vendor and model', () => {
    const inv = parseDiskInventory({
      blockdevices: [
        { type: 'disk', name: 'sda', path: '/dev/sda', model: 'ST4000VN008-2DR166', vendor: 'ATA' },
        { type: 'disk', name: 'sdb', path: '/dev/sdb', model: 'WEIRD BRAND X1', vendor: 'ACME' },
      ],
    });

    expect(inv.map((disk) => disk.name)).toEqual(['Seagate IronWolf 4TB', 'ACME WEIRD BRAND X1']);
  });
});

describe('parseDiskInventory (lsblk -J → DiskInfo[])', () => {
  const inv = parseDiskInventory(fixture('lsblk-mixed.json'));

  it('filters out non-disk block devices (partitions)', () => {
    expect(inv).toHaveLength(3);
  });

  it('derives friendly display names and kind', () => {
    expect(inv[0]).toEqual({
      kind: 'nvme',
      name: 'Crucial P3 1TB NVMe SSD',
      path: '/dev/nvme0n1',
      serial: 'AAA111',
    });
  });

  it('disambiguates duplicate names by device short-name', () => {
    const seagates = inv.filter((d) => d.kind === 'sata');
    expect(seagates.map((d) => d.name)).toEqual([
      'Seagate IronWolf 4TB (sda)',
      'Seagate IronWolf 4TB (sdb)',
    ]);
  });

  it('throws on malformed JSON (degradation is the I/O edge’s job)', () => {
    expect(() => parseDiskInventory('{ not json')).toThrow();
  });
});

describe('parseSensorsJson (sensors -j → SensorTree)', () => {
  const diskInv = parseDiskInventory(fixture('lsblk-mixed.json'));
  const tree = parseSensorsJson(fixture('sensors-amd.json'), diskInv);

  it('AMD k10temp: Tctl is CPU temp; Tccd* become cores', () => {
    expect(tree.cpuTempC).toBe(55.2);
    expect(tree.cores).toEqual([{ name: 'Tccd1', tempC: 48.0 }]);
  });

  it('maps nvme/drivetemp readings onto inventory display names in order', () => {
    expect(tree.disks).toEqual([
      { name: 'Crucial P3 1TB NVMe SSD', tempC: 41.85, type: 'nvme' },
      { name: 'Seagate IronWolf 4TB (sda)', tempC: 33.0, type: 'sata' },
      { name: 'Seagate IronWolf 4TB (sdb)', tempC: 35.0, type: 'sata' },
    ]);
  });

  it('jc42 → DIMM memory readings', () => {
    expect(tree.memory).toEqual([{ name: 'DIMM 1', tempC: 42.0, type: 'dimm' }]);
  });

  it('NIC chip temps get a friendly family name', () => {
    expect(tree.network).toEqual([{ name: 'Realtek NIC', tempC: 58.0, type: 'r8169' }]);
  });

  it('nct fan controller: fans prefixed by source, including 0 rpm', () => {
    expect(tree.fans).toEqual([
      { chip: 'nct6798-isa-0290', name: 'Mobo fan 1', rpm: 1200 },
      { chip: 'nct6798-isa-0290', name: 'Mobo fan 2', rpm: 0 },
    ]);
  });

  it('promotes SYSTIN to system temp (Motherboard) over the acpitz fallback', () => {
    expect(tree.systemTempC).toBe(36.0);
    expect(tree.systemTempLabel).toBe('Motherboard');
  });

  it('Intel coretemp: Package is CPU temp; Core N become cores', () => {
    const intel = parseSensorsJson(fixture('sensors-intel.json'));
    expect(intel.cpuTempC).toBe(60.0);
    expect(intel.cores).toEqual([
      { name: 'Core 0', tempC: 55.0 },
      { name: 'Core 1', tempC: 56.0 },
    ]);
  });

  it('falls back to acpitz for system temp when nothing better is present', () => {
    const acpi = parseSensorsJson(fixture('sensors-acpi-only.json'));
    expect(acpi.systemTempC).toBe(37.5);
    expect(acpi.systemTempLabel).toBe('System');
  });

  it('uses generic fallback disk labels when inventory is empty', () => {
    const noInv = parseSensorsJson(fixture('sensors-amd.json'), []);
    expect(noInv.disks.map((d) => d.name)).toEqual(['NVMe 1', 'SATA 1', 'SATA 2']);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseSensorsJson('{ not json')).toThrow();
  });
});
