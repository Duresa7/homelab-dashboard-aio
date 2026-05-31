/* =========================================================
   Inventory — persistent tracker.
   Seeded from `Datacenter/Inventory.md` + `Spare_Parts.md`.
   Persisted via the server-backed store (lib/store.ts); user can edit,
   export/import, reset.
   ========================================================= */

import { getState, setState } from './store';

export interface MetaRow {
  id: string;
  label: string;
  value: string;
}

export interface SpecRow extends ItemDetail {
  id: string;
  component: string;
  specification: string;
}

export type ItemStatus = 'working' | 'broken' | 'in-repair' | 'retired';

export interface PurchaseInfo {
  date?: string;          // ISO yyyy-mm-dd
  vendor?: string;
  price?: string;
  receiptRef?: string;
  warrantyEnd?: string;   // ISO yyyy-mm-dd
}

export interface ItemIds {
  serial?: string;
  /** Manufacturer part / configuration number (e.g. Seagate "PART-EXAMPLE-001"). */
  part?: string;
  uid?: string;
  mac?: string;
  assetTag?: string;
  location?: string;
}

export interface ProblemLogEntry {
  id: string;
  date: string;           // ISO yyyy-mm-dd
  note: string;
}

export interface ItemDetail {
  status?: ItemStatus;
  purchase?: PurchaseInfo;
  ids?: ItemIds;
  problemLog?: ProblemLogEntry[];
}

export interface Machine extends ItemDetail {
  id: string;
  name: string;
  role: string;
  /** Visible badge in the masthead of each card. e.g. "01", "02". */
  ordinal?: string;
  meta: MetaRow[];
  components: SpecRow[];
}

export interface SpareItem extends ItemDetail {
  id: string;
  /** Keyed by column id. */
  values: Record<string, string>;
}

export interface SpareColumn {
  id: string;
  label: string;
  /** Optional render hint; reserved for future. */
  align?: 'left' | 'right';
}

export interface SpareCategory {
  id: string;
  name: string;
  /** Short blurb / footnote shown under the section header. */
  note?: string;
  /** 2-digit category code used as a UID prefix for items in this category. e.g. "03" → 0301, 0302… */
  prefix?: string;
  /** Tab the category belongs to. 'spare' (default) lives under "Spare parts"; 'network' lives under its own "Network" tab for actively-deployed network gear. */
  kind?: 'spare' | 'network';
  columns: SpareColumn[];
  items: SpareItem[];
}

export interface Inventory {
  lastUpdated: string;
  machines: Machine[];
  spares: SpareCategory[];
}

/* ---------- ids ---------- */

let _idTick = 0;
export function genId(prefix = 'x'): string {
  _idTick += 1;
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${t}${r}${_idTick.toString(36)}`;
}

/* ---------- seed (from markdown) ---------- */

const m = (label: string, value: string): MetaRow => ({ id: genId('m'), label, value });
const c = (component: string, specification: string): SpecRow => ({
  id: genId('c'), component, specification,
});

function makeSeed(): Inventory {
  return {
    lastUpdated: '2026-05-30',
    machines: [
      {
        id: genId('mach'),
        ordinal: '01',
        name: 'Example PC',
        role: 'Windows workstation',
        meta: [
          m('Hostname', 'EXAMPLE-WORKSTATION'),
          m('IP', '198.51.100.10'),
          m('OS', 'Microsoft Windows 11 Pro'),
        ],
        components: [
          c('CPU',          'AMD Ryzen 9 9950X3D — 16C / 32T, AM5'),
          c('CPU Cooler',   'Arctic 420 mm AIO (Non-RGB)'),
          c('GPU',          'MSI Inspire 3X OC GeForce RTX 5070 Ti — 16 GB'),
          c('Motherboard',  'ASUS TUF Gaming X870-PLUS WiFi — AM5 / X870, ATX'),
          c('RAM',          'G.SKILL Trident Z5 Neo RGB — DDR5-6000 32 GB (2×16 GB), CL30, 1.35 V, AMD EXPO'),
          c('Storage 1',    'Samsung 990 Pro — 2 TB NVMe M.2'),
          c('Storage 2',    'Samsung 980 — 1 TB NVMe M.2'),
          c('PSU',          'CORSAIR RM850e (2025)'),
          c('Case',         'Antec FLUX Wood — Mid-Tower E-ATX, walnut wood front, 5× PWM fans, Type-C'),
          c('Thermal Paste','Thermal Grizzly Kryonaut'),
          c('NIC',          'Realtek 2.5 GbE (onboard)'),
        ],
      },
      {
        id: genId('mach'),
        ordinal: '02',
        name: 'OBI PC',
        role: 'Windows workstation',
        meta: [
          m('Hostname', 'EXAMPLE-PC'),
          m('Domain',   'example.test'),
          m('IP',       '198.51.100.10'),
          m('OS',       'Microsoft Windows 11 Pro'),
        ],
        components: [
          c('CPU',          'AMD Ryzen 7 7700X — 8C / 16T, AM5'),
          c('CPU Cooler',   'Cooler Master 240 mm AIO'),
          c('GPU',          'MSI NVIDIA GeForce RTX 3070 8GB'),
          c('Motherboard',  'ASUS TUF Gaming B650-PLUS WiFi — AM5 / B650'),
          c('RAM',          'G.SKILL F5-6000J3636F16G — DDR5-6000 32 GB (2×16 GB)'),
          c('Storage 1',    'Crucial CT500P310SSD8 — 500 GB NVMe SSD'),
          c('Storage 2',    'Empty (M.2 NVMe slot)'),
          c('PSU',          'CORSAIR 750 W'),
          c('Case',         'NZXT H5 Flow (2023)'),
          c('Thermal Paste','Thermal Grizzly Kryonaut'),
          c('NIC',          'Realtek 2.5 GbE (onboard)'),
        ],
      },
      {
        id: genId('mach'),
        ordinal: '03',
        name: 'example-server',
        role: 'Proxmox host',
        meta: [
          m('Hostname', 'example-server'),
          m('IP',       '198.51.100.10'),
          m('OS',       'Proxmox VE 9 (Debian 13 "Trixie")'),
        ],
        components: [
          c('CPU',          'AMD Ryzen 7 3700X — 8C / 16T, AM4'),
          c('CPU Cooler',   'Thermalright Phantom Spirit 120 SE Black — dual-tower, 7 heat pipes, 2× TL-C12B V2'),
          c('GPU',          'NVIDIA GeForce GTX 1080 Ti — 11 GB'),
          c('Motherboard',  'MSI MAG B550 Tomahawk'),
          c('RAM',          'G.SKILL Ripjaws V — DDR4-3600 64 GB (4×16 GB), 2× F4-3600C18D-32GVK kits, CL18, XMP'),
          c('Storage 1',    'Crucial CT1000P310SSD8 — 1 TB NVMe SSD'),
          c('Storage 2',    'Crucial CT2000BX500SSD1 — 2 TB SATA SSD'),
          c('Storage 3',    'Toshiba DT01ACA200 — 2 TB 3.5" SATA HDD'),
          c('PSU',          'Powerspec 750 W ATX (Non-Modular)'),
          c('Case',         'NZXT H510i'),
          c('Thermal Paste','Thermal Grizzly Kryonaut'),
          c('NIC 1',        'Realtek RTL8125 — 2.5 GbE (onboard)'),
          c('NIC 2',        'Realtek RTL8111/8168 — 1 GbE (onboard)'),
        ],
      },
      {
        id: genId('mach'),
        ordinal: '04',
        name: 'NAS NAS',
        role: 'Network-attached storage',
        meta: [
          m('Brand / Model', 'Ubiquiti UniFi UNAS 4 (4-bay)'),
          m('IP', '198.51.100.10'),
        ],
        components: [
          c('CPU',         'Quad-core ARM Cortex-A55 @ 1.7 GHz'),
          c('RAM',         '4 GB'),
          c('Drive Bay 1', 'WD Red Plus WD40EFPX-68C6CN0 — 4 TB 3.5" SATA HDD'),
          c('Drive Bay 2', 'WD Purple WD60PURX-64LZMY0 — 6 TB 3.5" SATA HDD (surveillance)'),
          c('Drive Bay 3', 'WD Blue WD5000LPVX-08V0TT5 — 500 GB 2.5" SATA HDD'),
          c('Drive Bay 4', 'HGST HTS725050A7E630 — 500 GB 2.5" SATA HDD'),
          c('NVMe Slot 1', 'WDC PC SN720 SDAQNTW — 512 GB NVMe M.2'),
          c('NVMe Slot 2', 'Empty (M.2 NVMe, up to 2 TiB)'),
          c('NIC',         '2.5 GbE RJ45 (PoE+++ powered)'),
          c('USB',         'USB-C 5 Gbps'),
          c('Wireless',    'Bluetooth 4.1'),
          c('Display',     '1.47" color LCM'),
          c('Power',       '90 W PoE+++'),
        ],
      },
      {
        id: genId('mach'),
        ordinal: '05',
        name: 'node-b',
        role: 'Proxmox host',
        meta: [
          m('Hostname', 'node-b'),
          m('IP',       '198.51.100.10'),
          m('OS',       'Proxmox VE 9'),
          m('Model',    'Lenovo ThinkCentre M920q Tiny'),
        ],
        components: [
          c('CPU',          'Intel 8th-gen Core (T-series, LGA1151)'),
          c('RAM (DIMM1)',  'Micron MTA8ATF1G64HZ-2G6E1 — 8 GB DDR4-2666 SO-DIMM (Lenovo FRU 01AG841)'),
          c('RAM (DIMM2)',  'SK hynix HMA81GS6AFR8N-UH — 8 GB DDR4-2400 SO-DIMM'),
          c('RAM total',    '16 GB (2×8 GB; runs at 2400 MT/s — slower module sets the bus)'),
          c('Storage 1',    'Samsung PM981 (MZ-VLB2560) — 256 GB NVMe M.2 (slot 1)'),
          c('Chassis',      'Lenovo ThinkCentre M920q Tiny — MTM ASSET-EXAMPLE-001, 20 V / 3.25 A'),
          c('NIC',          'Onboard 1 GbE'),
        ],
        ids: { serial: 'SERIAL-EXAMPLE-001', assetTag: 'ASSET-EXAMPLE-001' },
      },
      {
        id: genId('mach'),
        ordinal: '06',
        name: 'node-c',
        role: 'Proxmox host',
        meta: [
          m('Hostname', 'node-c'),
          m('IP',       '198.51.100.10'),
          m('OS',       'Proxmox VE 9'),
          m('Model',    'Lenovo ThinkCentre M910q Tiny'),
        ],
        components: [
          c('CPU',          'Intel 6th/7th-gen Core (T-series, LGA1151)'),
          c('RAM (DIMM1)',  'SK hynix HMA81GS6CJR8N-VK — 8 GB DDR4-2666 SO-DIMM (Lenovo FRU 01AG824, factory)'),
          c('RAM (DIMM2)',  'SK hynix HMA851S6AFR6N-UH — 4 GB DDR4-2400 SO-DIMM'),
          c('RAM total',    '12 GB (8 GB + 4 GB; runs at 2400 MT/s — slower module sets the bus)'),
          c('Storage 1',    'Samsung PM961 (MZ-VLW2560) — 256 GB NVMe M.2 (slot 1, Lenovo FRU 00UP436)'),
          c('Chassis',      'Lenovo ThinkCentre M910q Tiny — MTM 10MU / S08B00, MFG 04/2018, 20 V / 3.25 A'),
          c('NIC',          'Onboard 1 GbE'),
        ],
        ids: { serial: 'SERIAL-EXAMPLE-002', assetTag: 'ASSET-EXAMPLE-002' },
      },
    ],
    spares: [
      {
        id: genId('cat'),
        name: 'UniFi Network Infrastructure',
        note: 'Active Ubiquiti gear powering the network.',
        kind: 'network',
        columns: [
          { id: 'role',  label: 'Role' },
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'notes', label: 'Notes' },
          { id: 'qty',   label: 'Qty', align: 'right' },
        ],
        items: [
          { id: genId('s'), values: { role: 'Gateway / Router', brand: 'Ubiquiti', model: 'UCG-Fiber (UniFi Cloud Gateway Fiber)', notes: 'Multi-gig fiber gateway', qty: '1' } },
          { id: genId('s'), values: { role: 'Switch',           brand: 'Ubiquiti', model: 'USW-Flex-2.5G-5 (Flex 2.5G 5-port)',   notes: '2.5 GbE, 5 ports',         qty: '2' } },
          { id: genId('s'), values: { role: 'Switch',           brand: 'Ubiquiti', model: 'USW-Pro-Max-16-PoE (Pro Max 16 PoE)',  notes: '16-port multi-gig PoE',    qty: '1' } },
          { id: genId('s'), values: { role: 'Wi-Fi AP',         brand: 'Ubiquiti', model: 'U7-Pro-XG',                            notes: 'Wi-Fi 7, 10 GbE uplink',   qty: '1' } },
          { id: genId('s'), values: { role: 'Camera',           brand: 'Ubiquiti', model: 'UVC-G6-Bullet (Protect G6 Bullet)',    notes: 'PoE bullet security cam',  qty: '1' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'Laptops',
        columns: [
          { id: 'brand',   label: 'Brand' },
          { id: 'model',   label: 'Model' },
          { id: 'cpu',     label: 'CPU' },
          { id: 'ram',     label: 'RAM' },
          { id: 'storage', label: 'Storage' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'Apple',  model: 'MacBook Air (M1)',                 cpu: 'Apple M1',     ram: '8 GB',  storage: '256 GB' } },
          { id: genId('s'), values: { brand: 'Apple',  model: 'MacBook Pro 15" 2017 (Touch Bar)', cpu: 'Intel Core i7', ram: '16 GB', storage: '1 TB'   } },
          { id: genId('s'), values: { brand: 'Lenovo', model: 'ThinkPad T440',                    cpu: 'Verify on boot (Intel 4th-gen Core)', ram: 'Verify on boot', storage: 'Verify on boot' } },
          { id: genId('s'), values: { brand: 'Lenovo', model: 'ThinkPad T470s',                   cpu: 'Verify on boot (Intel 7th-gen Core)', ram: 'Verify on boot', storage: 'Verify on boot' } },
          { id: genId('s'), values: { brand: 'Lenovo', model: 'ThinkPad T480',                    cpu: 'Verify on boot (Intel 8th-gen Core)', ram: 'Verify on boot', storage: 'Verify on boot' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'CPUs',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'Intel', model: 'Core i7-5820K', notes: '6-core, LGA 2011-v3' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'CPU Coolers',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'AMD', model: 'Wraith Prism',   notes: 'Stock cooler, RGB' } },
          { id: genId('s'), values: { brand: 'AMD', model: 'Wraith Stealth', notes: 'Stock cooler' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'SSDs',
        columns: [
          { id: 'brand',    label: 'Brand' },
          { id: 'model',    label: 'Model' },
          { id: 'capacity', label: 'Capacity' },
          { id: 'form',     label: 'Form Factor' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'Samsung',  model: '850 EVO',            capacity: '250 GB', form: '2.5" SATA' } },
          { id: genId('s'), values: { brand: 'Kingston', model: 'RBU-SNS4151S3/16GD', capacity: '16 GB',  form: 'OEM SSD'   } },
        ],
      },
      {
        id: genId('cat'),
        name: 'HDDs',
        columns: [
          { id: 'brand',    label: 'Brand' },
          { id: 'model',    label: 'Model' },
          { id: 'capacity', label: 'Capacity' },
          { id: 'form',     label: 'Form Factor' },
        ],
        items: [
          { id: genId('s'), ids: { serial: 'SERIAL-EXAMPLE-003', part: 'PART-EXAMPLE-001' }, values: { brand: 'Seagate', model: 'ST1000LM035 (Mobile HDD)', capacity: '1 TB', form: '2.5"' } },
          { id: genId('s'), ids: { serial: 'WXE1A35D6NSN' }, values: { brand: 'WD Blue', model: 'WD5000LPVX-08V0T', capacity: '500 GB', form: '2.5" SATA 6Gb/s · 5400 RPM' } },
          { id: genId('s'), status: 'broken', problemLog: [{ id: genId('p'), date: '2026-05-30', note: 'Bad sectors detected, end of life — failed its SMART test.' }], values: { brand: 'WD Purple', model: 'WD40PURX-64GVNY0', capacity: '4 TB', form: '3.5"' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'RAM',
        columns: [
          { id: 'brand',    label: 'Brand' },
          { id: 'part',     label: 'Part Number' },
          { id: 'capacity', label: 'Capacity' },
          { id: 'type',     label: 'Type' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'SK hynix', part: 'HMT351S6EFR8A',    capacity: '4 GB', type: 'DDR3L-1600 SO-DIMM (PC3L-12800S), 2Rx8' } },
          { id: genId('s'), values: { brand: 'Samsung',  part: 'M471A5644EB0-CPB', capacity: '2 GB', type: 'DDR4-2133 SO-DIMM (PC4-2133P), 1Rx16'  } },
        ],
      },
      {
        id: genId('cat'),
        name: 'Networking (legacy)',
        note: 'Earlier networking gear retained as spares.',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'type',  label: 'Type' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'Cisco',     model: 'FPR-1010 (Firepower 1010)', type: 'Next-gen firewall / security appliance', notes: 'PID: FPR-1010 V01, 8× 1 GbE + mgmt, SN JMX2726X1SC, mfg 06/29/2023, Made in Mexico' } },
          { id: genId('s'), values: { brand: 'ASUS',      model: 'RT-AX3000',       type: 'Wi-Fi 6 router',                          notes: '' } },
          { id: genId('s'), values: { brand: 'TP-Link',   model: 'TL-SG108E',       type: '8-port managed switch (1 GbE)',           notes: 'Easy Smart, QoS / VLAN / IGMP / LAG' } },
          { id: genId('s'), values: { brand: 'Netgear',   model: 'GS308',           type: '8-port unmanaged switch (1 GbE)',         notes: '' } },
          { id: genId('s'), values: { brand: 'Netgear',   model: 'GS608',           type: '8-port unmanaged switch (1 GbE)',         notes: '' } },
          { id: genId('s'), values: { brand: 'Netgear',   model: 'FS726TP ProSafe', type: '24-port smart switch (10/100) + 2× 1 GbE', notes: 'PoE' } },
          { id: genId('s'), values: { brand: '(Generic)', model: 'PS1080',          type: '8-port PoE unmanaged switch (1 GbE)',     notes: 'IEEE 802.3af, 100–240 VAC input, 48 VDC output' } },
        ],
      },
      {
        id: genId('cat'),
        name: 'Printers',
        columns: [
          { id: 'brand', label: 'Brand' },
          { id: 'model', label: 'Model' },
          { id: 'type',  label: 'Type' },
          { id: 'notes', label: 'Notes' },
        ],
        items: [
          { id: genId('s'), values: { brand: 'HP', model: 'DeskJet 4255e', type: 'All-in-one inkjet (print/scan/copy)', notes: 'Wi-Fi' } },
        ],
      },
    ],
  };
}

/* ---------- storage ---------- */

const STORAGE_KEY = 'inventory';
const SCHEMA_VERSION = 6;

interface Persisted {
  v: number;
  data: Inventory;
}

/** Best-effort UID for a machine, derived from its name. e.g. "Example PC" → "EXAMPLE-PC". */
export function suggestMachineUid(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'MACHINE';
}

/** Best-effort UID for a component, scoped to its machine. e.g. ("Example PC", "CPU") → "EXAMPLE-PC-CPU". */
export function suggestComponentUid(machineName: string, component: string): string {
  const m = suggestMachineUid(machineName);
  const c = component
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return c ? `${m}-${c}` : m;
}

/* ---------- spare category UIDs ---------- */

/**
 * Heuristic mapping from category name to its preferred 2-digit prefix.
 * First match wins; falls back to the next free 2-digit code.
 */
const PREFIX_HEURISTICS: Array<[RegExp, string]> = [
  [/laptop|workstation/i,                                      '01'],
  [/server|nas/i,                                              '02'],
  [/unifi|network|switch|router|firewall|gateway|wi[- ]?fi/i,  '03'],
  [/cpu cooler|cooler|aio/i,                                   '05'],
  [/cpu(?! cooler)|processor/i,                                '04'],
  [/ssd/i,                                                     '06'],
  [/hdd|drive|disk/i,                                          '07'],
  [/ram\b|memory|dimm/i,                                       '08'],
  [/printer/i,                                                 '09'],
  [/gpu|graphics/i,                                            '10'],
  [/psu|power supply/i,                                        '11'],
  [/case|chassis/i,                                            '12'],
  [/cable|adapter/i,                                           '13'],
  [/peripheral|keyboard|mouse|monitor|display/i,               '14'],
];

/** Pick a sensible 2-digit prefix for a category name, avoiding `used`. */
export function suggestCategoryPrefix(name: string, used: Iterable<string> = []): string {
  const taken = new Set(used);
  for (const [re, code] of PREFIX_HEURISTICS) {
    if (re.test(name) && !taken.has(code)) return code;
  }
  for (let i = 1; i < 100; i += 1) {
    const code = String(i).padStart(2, '0');
    if (!taken.has(code)) return code;
  }
  return '00';
}

/** True if `uid` looks like a previously auto-generated random UID (pre-prefix scheme). */
function isLegacyAutoUid(uid?: string): boolean {
  if (!uid) return true;
  return /^UID_/i.test(uid);
}

/** Next available `{prefix}{nn}` UID for a spare category. */
export function nextSpareUid(category: SpareCategory): string {
  const prefix = category.prefix ?? '00';
  const used = new Set<number>();
  for (const it of category.items) {
    const uid = it.ids?.uid;
    if (uid && uid.startsWith(prefix)) {
      const n = parseInt(uid.slice(prefix.length), 10);
      if (!Number.isNaN(n)) used.add(n);
    }
  }
  for (let i = 1; i < 1000; i += 1) {
    if (!used.has(i)) return `${prefix}${String(i).padStart(2, '0')}`;
  }
  return `${prefix}99`;
}

/** Ensure an item has the detail fields filled in with safe defaults. Mutates in place. */
function ensureDetail<T extends ItemDetail>(item: T, fallbackUid: string): void {
  if (!item.status) item.status = 'working';
  if (!item.purchase) item.purchase = {};
  if (!item.ids) item.ids = {};
  if (!item.ids.uid) item.ids.uid = fallbackUid;
  if (!item.problemLog) item.problemLog = [];
}

// Deep-clone the inventory before mutation. getState returns the Map's
// stored reference; mutating it leaks migration defaults back into the
// canonical state and corrupts other readers.
function cloneInventory(data: Inventory): Inventory {
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

function migrateInventory(data: Inventory): Inventory {
  const cloned = cloneInventory(data);
  for (const m of cloned.machines) {
    ensureDetail(m, suggestMachineUid(m.name));
    for (const row of m.components) {
      ensureDetail(row, suggestComponentUid(m.name, row.component));
    }
  }
  const usedPrefixes = new Set<string>();
  for (const cat of cloned.spares) {
    if (cat.prefix) usedPrefixes.add(cat.prefix);
  }
  for (const cat of cloned.spares) {
    if (!cat.prefix) {
      cat.prefix = suggestCategoryPrefix(cat.name, usedPrefixes);
      usedPrefixes.add(cat.prefix);
    }
    let seq = 1;
    for (const it of cat.items) {
      if (!it.ids) it.ids = {};
      // Replace empty or legacy random UIDs with category-prefixed sequentials,
      // but preserve user-edited UIDs (anything that doesn't match the legacy
      // `UID_*` pattern).
      if (isLegacyAutoUid(it.ids.uid)) {
        it.ids.uid = `${cat.prefix}${String(seq).padStart(2, '0')}`;
      }
      seq += 1;
      ensureDetail(it, it.ids.uid ?? `${cat.prefix}${String(seq).padStart(2, '0')}`);
    }
  }
  return cloned;
}

export function loadInventory(): Inventory {
  const persisted = getState<Persisted | null>(STORAGE_KEY, null);
  if (!persisted?.data) return migrateInventory(makeSeed());
  if (persisted.v < SCHEMA_VERSION) {
    const migrated = migrateInventory(persisted.data);
    saveInventory(migrated);
    return migrated;
  }
  if (persisted.v > SCHEMA_VERSION) {
    // Forward-compat: a future build wrote v > SCHEMA_VERSION and we've
    // since rolled back. We don't understand the future shape, but we
    // refuse to silently overwrite it with the seed — preserve the user's
    // data, fill missing detail fields, and DO NOT call saveInventory so
    // the higher-versioned payload stays untouched on disk.
    if (typeof console !== 'undefined') {
      console.warn(
        `[inventory] persisted v=${persisted.v} > supported v=${SCHEMA_VERSION}; ` +
        `rendering preserved data without saving. Upgrade the app to write back.`,
      );
    }
    return migrateInventory(persisted.data);
  }
  return migrateInventory(persisted.data); // re-ensure in case of partial data
}

export function saveInventory(inv: Inventory): void {
  const payload: Persisted = { v: SCHEMA_VERSION, data: inv };
  setState<Persisted>(STORAGE_KEY, payload);
}

export function resetInventory(): Inventory {
  const fresh = makeSeed();
  saveInventory(fresh);
  return fresh;
}

/* ---------- serialization helpers ---------- */

export function exportInventoryJSON(inv: Inventory): string {
  return JSON.stringify({ v: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: inv }, null, 2);
}

export function tryImportInventoryJSON(text: string): Inventory | null {
  try {
    const parsed = JSON.parse(text) as { v?: number; data?: Inventory } | Inventory;
    const candidate = (parsed as { data?: Inventory }).data ?? (parsed as Inventory);
    if (!candidate || !Array.isArray((candidate as Inventory).machines) || !Array.isArray((candidate as Inventory).spares)) {
      return null;
    }
    return migrateInventory(candidate as Inventory);
  } catch {
    return null;
  }
}

/* ---------- item lookup ---------- */

export type FoundItem =
  | { kind: 'machine';   machine: Machine }
  | { kind: 'spare';     item: SpareItem; category: SpareCategory }
  | { kind: 'component'; component: SpecRow; machine: Machine };

export function findItem(inv: Inventory, id: string): FoundItem | null {
  const machine = inv.machines.find((m) => m.id === id);
  if (machine) return { kind: 'machine', machine };
  for (const m of inv.machines) {
    const comp = m.components.find((c) => c.id === id);
    if (comp) return { kind: 'component', component: comp, machine: m };
  }
  for (const cat of inv.spares) {
    const it = cat.items.find((x) => x.id === id);
    if (it) return { kind: 'spare', item: it, category: cat };
  }
  return null;
}

/* ---------- summary stats ---------- */

export interface InventoryStats {
  machineCount: number;
  componentCount: number;
  spareCategoryCount: number;
  spareItemCount: number;
  networkCategoryCount: number;
  networkItemCount: number;
}

export function summarize(inv: Inventory): InventoryStats {
  let components = 0;
  for (const ma of inv.machines) components += ma.components.length;
  let spareCats = 0;
  let spareItems = 0;
  let networkCats = 0;
  let networkItems = 0;
  for (const cat of inv.spares) {
    if (cat.kind === 'network') {
      networkCats += 1;
      networkItems += cat.items.length;
    } else {
      spareCats += 1;
      spareItems += cat.items.length;
    }
  }
  return {
    machineCount: inv.machines.length,
    componentCount: components,
    spareCategoryCount: spareCats,
    spareItemCount: spareItems,
    networkCategoryCount: networkCats,
    networkItemCount: networkItems,
  };
}
