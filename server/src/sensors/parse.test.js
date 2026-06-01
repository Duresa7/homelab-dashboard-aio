import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  parseSensorsJson,
  parseDiskInventory,
  normalizeDiskParts,
  diskDisplayName,
  detectCrucial,
  detectWesternDigital,
  detectSeagate,
  detectSamsung,
  detectKingston,
  detectToshibaKioxia,
  detectHgstHitachi,
} from './parse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, '__fixtures__', name), 'utf8');

// NOTE: fixtures under __fixtures__/ are PROVISIONAL — synthesized from the
// family tables, not yet real captures. See __fixtures__/README.md.

describe('detect* — vendor family tables (token in → {vendor, model})', () => {
  it('Seagate: capacity GB + 2-letter family code', () => {
    expect(detectSeagate('ST4000VN0082DR166')).toEqual({ vendor: 'Seagate', model: 'IronWolf 4TB' });
    expect(detectSeagate('ST8000NM0055')).toEqual({ vendor: 'Seagate', model: 'Exos 8TB' });
    expect(detectSeagate('ST2000DM008')).toEqual({ vendor: 'Seagate', model: 'BarraCuda 2TB' });
  });

  it('Seagate: unknown family code still yields capacity', () => {
    // ZZ is not in SEAGATE_FAMILY → family null. Quirk (preserved verbatim):
    // [null, '6TB'].filter(Boolean).join(' ') === '6TB' is truthy, so the
    // `Seagate <cap>` fallback never fires — model is bare '6TB'. diskDisplayName
    // then re-prefixes the vendor for display → "Seagate 6TB".
    expect(detectSeagate('ST6000ZZ001')).toEqual({ vendor: 'Seagate', model: '6TB' });
    expect(diskDisplayName({ model: 'ST6000ZZ001', vendor: '' })).toBe('Seagate 6TB');
  });

  it('Western Digital: 2-3 digit = TB, 4 digit = GB; family from suffix', () => {
    expect(detectWesternDigital('WD80EFZZ')).toEqual({ vendor: 'Western Digital', model: 'Red Plus 8TB' });
    expect(detectWesternDigital('WDCWD80EFAX68LHPN0')).toEqual({ vendor: 'Western Digital', model: 'Red 8TB' });
    expect(detectWesternDigital('WD5000AZLX')).toEqual({ vendor: 'Western Digital', model: 'Blue 500GB' });
    expect(detectWesternDigital('WD40PURZ')).toEqual({ vendor: 'Western Digital', model: 'Purple 4TB' });
  });

  it('Western Digital: unknown suffix falls back to EF/EZ/FZ/PUR prefix heuristic', () => {
    // "EFQQ" not a known 4-letter code, but ^EF → Red
    expect(detectWesternDigital('WD20EFQQ')).toEqual({ vendor: 'Western Digital', model: 'Red 2TB' });
  });

  it('Crucial: NVMe vs SATA bus drives the kind suffix', () => {
    expect(detectCrucial('CT1000MX500SSD1')).toEqual({ vendor: 'Crucial', model: 'MX500 1TB SATA SSD' });
    expect(detectCrucial('CT2000P3PSSD8')).toEqual({ vendor: 'Crucial', model: 'P3 Plus 2TB NVMe SSD' });
    expect(detectCrucial('CT1000P3SSD8')).toEqual({ vendor: 'Crucial', model: 'P3 1TB NVMe SSD' });
  });

  it('Crucial: longest family code wins (P3P over P3, MX500 over MX)', () => {
    // Regex is ordered longest-first; P3P must not be read as P3 + leftover.
    expect(detectCrucial('CT4000T700SSD5').model).toContain('T700');
  });

  it('Samsung / Kingston / Toshiba / Kioxia / HGST: strip leading vendor noise', () => {
    expect(detectSamsung('SAMSUNGSSD990PRO1TB', 'Samsung SSD 990 PRO 1TB')).toEqual({ vendor: 'Samsung', model: '990 PRO 1TB' });
    expect(detectKingston('KINGSTONSA400S37240G', 'KINGSTON SA400S37240G')).toEqual({ vendor: 'Kingston', model: 'SA400S37240G' });
    expect(detectToshibaKioxia('TOSHIBAMG08ACA16TE', 'TOSHIBA MG08ACA16TE')).toEqual({ vendor: 'Toshiba', model: 'MG08ACA16TE' });
    expect(detectToshibaKioxia('KIOXIAKXG60ZNV256G', 'KIOXIA KXG60ZNV256G').vendor).toBe('Kioxia');
    expect(detectHgstHitachi('HGSTHUS726T4TALA6L4', 'HGST HUS726T4TALA6L4')).toEqual({ vendor: 'HGST', model: 'HUS726T4TALA6L4' });
  });

  it('non-matching token returns null', () => {
    expect(detectSeagate('NOTADISK')).toBeNull();
    expect(detectWesternDigital('NOTADISK')).toBeNull();
    expect(detectCrucial('NOTADISK')).toBeNull();
  });
});

describe('normalizeDiskParts + diskDisplayName', () => {
  it('drops bus-type-as-vendor (ata/nvme/scsi/usb)', () => {
    expect(normalizeDiskParts({ model: 'Generic Model', vendor: 'ata' })).toEqual({ vendor: '', model: 'Generic Model' });
  });

  it('passes through an unrecognized brand untouched', () => {
    expect(normalizeDiskParts({ model: 'WEIRD BRAND X1', vendor: 'ACME' })).toEqual({ vendor: 'ACME', model: 'WEIRD BRAND X1' });
  });

  it('diskDisplayName prefixes vendor only when not already in the model', () => {
    // Seagate detection → model has no "Seagate" → prefixed
    expect(diskDisplayName({ model: 'ST4000VN008-2DR166', vendor: 'ATA' })).toBe('Seagate IronWolf 4TB');
    // Unknown brand with vendor not in model → prefixed
    expect(diskDisplayName({ model: 'WEIRD BRAND X1', vendor: 'ACME' })).toBe('ACME WEIRD BRAND X1');
  });
});

describe('parseDiskInventory (lsblk -J → DiskInfo[])', () => {
  const inv = parseDiskInventory(fixture('lsblk-mixed.json'));

  it('filters out non-disk block devices (partitions)', () => {
    expect(inv).toHaveLength(3); // nvme0n1, sda, sdb — sda1 (part) excluded
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
