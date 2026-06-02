/* =========================================================
   Inventory — persistent tracker (v2 model).

   Two top-level entities:
   - `machines`     — active host chassis (PCs / servers / NAS). Block 08xx.
   - `components`   — ONE flat pool of parts (CPU/GPU/RAM/…). Each carries
                      structured `fields`, a type-block UID (CPU 1000, GPU 2000…),
                      and an `assignment` (a machine id, or the literal 'spare').
   - `spares`       — DEVICE categories only now (laptops 01, phones 02, printers
                      03, network 04, peripherals 05, monitors 06, cameras 07).
                      Each item has a per-item `deployment` (in-service|spare).

   Seeded from `Datacenter/Inventory.md` + `Spare_Parts.md`. Persisted via the
   server-backed store (lib/store.ts); user can edit, export/import, reset.
   ========================================================= */

import { getState, setState, isDegraded } from './store';

export interface MetaRow {
  id: string;
  label: string;
  value: string;
}

export type ItemStatus = 'working' | 'broken' | 'in-repair' | 'retired';

/** Whether a part/device is deployed (in-service) or sitting in the drawer (spare). */
export type Deployment = 'in-service' | 'spare';

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

/* ---------- components ---------- */

export type ComponentType =
  | 'cpu' | 'gpu' | 'motherboard' | 'ram' | 'storage'
  | 'psu' | 'cooler' | 'case' | 'nic' | 'other';

/** One labeled spec row, e.g. { label: 'Cores', value: '16' }. */
export interface SpecField {
  id: string;
  label: string;
  value: string;
}

/** The literal value of `Component.assignment` when a part is not installed. */
export const SPARE = 'spare';

export interface Component extends ItemDetail {
  id: string;
  type: ComponentType;
  /** Display label, e.g. "GPU", "RAM 1", "Storage 1". */
  label: string;
  fields: SpecField[];
  /** Original free-text spec, preserved on migration so nothing is ever lost. */
  rawSpec?: string;
  /** A machine id, or the literal `SPARE` ('spare'). UID is stable across changes. */
  assignment: string;
}

export interface Machine extends ItemDetail {
  id: string;
  name: string;
  role: string;
  /** Visible badge in the masthead of each card. e.g. "01", "02". */
  ordinal?: string;
  deployment: Deployment;
  meta: MetaRow[];
}

/* ---------- device categories (spares) ---------- */

export type DeviceCategoryType =
  | 'laptop' | 'phone' | 'printer' | 'network'
  | 'peripheral' | 'monitor' | 'camera' | 'other';

export interface SpareItem extends ItemDetail {
  id: string;
  /** Friendly name (laptops + network gear). Falls back to model/brand for display. */
  name?: string;
  deployment: Deployment;
  /** Keyed by column id. */
  values: Record<string, string>;
}

export interface SpareColumn {
  id: string;
  label: string;
  align?: 'left' | 'right';
}

export interface SpareCategory {
  id: string;
  name: string;
  note?: string;
  /** 2-digit UID block, e.g. "01" → 0101, 0102… */
  prefix?: string;
  /** Canonical device kind (drives the block + icon). */
  deviceType?: DeviceCategoryType;
  /** @deprecated pre-v7 network split; superseded by deviceType. */
  kind?: 'spare' | 'network';
  columns: SpareColumn[];
  items: SpareItem[];
}

export interface Inventory {
  lastUpdated: string;
  machines: Machine[];
  components: Component[];
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

function field(label: string, value: string): SpecField {
  return { id: genId('f'), label, value };
}

/* ---------- UID blocks ---------- */

/** Component type → 1000-wide UID block base. */
export const COMPONENT_BLOCKS: Record<ComponentType, number> = {
  cpu: 1000, gpu: 2000, motherboard: 3000, ram: 4000, storage: 5000,
  psu: 6000, cooler: 7000, case: 8000, nic: 9000, other: 10000,
};

/** Device category type → 2-digit UID block prefix. */
export const DEVICE_BLOCKS: Record<DeviceCategoryType, string> = {
  laptop: '01', phone: '02', printer: '03', network: '04',
  peripheral: '05', monitor: '06', camera: '07', other: '09',
};

/** Active machines (PCs / servers / NAS) all share this block. */
export const MACHINE_BLOCK = '08';

/** Default labeled fields offered when adding a component of each type. */
export const COMPONENT_TYPE_FIELDS: Record<ComponentType, string[]> = {
  cpu:         ['Brand', 'Model', 'Cores', 'Threads', 'Socket', 'TDP'],
  gpu:         ['Brand', 'Model', 'VRAM', 'Interface'],
  motherboard: ['Brand', 'Model', 'Socket', 'Chipset', 'Form Factor'],
  ram:         ['Brand', 'Model', 'Type', 'Speed', 'Capacity', 'Timing', 'Voltage', 'Profile'],
  storage:     ['Brand', 'Model', 'Capacity', 'Form Factor', 'Interface'],
  psu:         ['Brand', 'Model', 'Wattage', 'Rating', 'Modular'],
  cooler:      ['Brand', 'Model', 'Type', 'Size'],
  case:        ['Brand', 'Model', 'Form Factor'],
  nic:         ['Brand', 'Model', 'Speed', 'Interface'],
  other:       ['Brand', 'Model'],
};

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  cpu: 'CPU', gpu: 'GPU', motherboard: 'Motherboard', ram: 'RAM', storage: 'Storage',
  psu: 'PSU', cooler: 'Cooler', case: 'Case', nic: 'NIC', other: 'Other',
};

export const DEVICE_TYPE_LABELS: Record<DeviceCategoryType, string> = {
  laptop: 'Laptops', phone: 'Phones', printer: 'Printers', network: 'Network',
  peripheral: 'Peripherals', monitor: 'Monitors', camera: 'Cameras', other: 'Devices',
};

/** Detect a canonical component type from its label (and optional spec text). */
export function detectComponentType(label: string, spec = ''): ComponentType {
  const k = `${label} ${spec}`.toLowerCase();
  if (/coolers?|\baio\b|heatsink|radiator|\bfans?\b|thermal\s*paste|\bpaste\b/.test(k)) return 'cooler';
  if (/\bcpus?\b|processor/.test(k))                      return 'cpu';
  if (/\bgpus?\b|graphics|geforce|radeon|video\s*card/.test(k)) return 'gpu';
  if (/motherboards?|mainboards?|\bmobo\b/.test(k))       return 'motherboard';
  if (/\bram\b|memory|dimm|dram/.test(k))                 return 'ram';
  if (/storage|drive\s*bay|\bssds?\b|\bhdds?\b|\bnvme\b|m\.2|hard\s*drives?/.test(k)) return 'storage';
  if (/\bpsus?\b|power\s*supply|power supplies/.test(k))  return 'psu';
  if (/\bcase\b|chassis|tower/.test(k))                   return 'case';
  if (/\bnics?\b|ethernet|\blan\b|network\s*card/.test(k)) return 'nic';
  return 'other';
}

/** Detect a canonical device category type from a category name. */
export function detectDeviceType(name: string): DeviceCategoryType {
  const k = name.toLowerCase();
  if (/unifi|network|switch|router|gateway|firewall|wi[- ]?fi|\bap\b/.test(k)) return 'network';
  if (/laptop|notebook|macbook|thinkpad/.test(k)) return 'laptop';
  if (/phone|iphone|android|pixel|galaxy/.test(k)) return 'phone';
  if (/print/.test(k))                             return 'printer';
  if (/camera|\bcam\b|protect|bullet/.test(k))     return 'camera';
  if (/monitor|display|screen/.test(k))            return 'monitor';
  if (/peripheral|keyboard|mouse|headset|dock/.test(k)) return 'peripheral';
  return 'other';
}

function num(uid: string | undefined): number | null {
  if (!uid) return null;
  const n = parseInt(uid, 10);
  return Number.isNaN(n) ? null : n;
}

/** Next free UID in a component type block (global across installed + spare). */
export function nextComponentUid(type: ComponentType, components: Component[]): string {
  const base = COMPONENT_BLOCKS[type];
  const used = new Set<number>();
  for (const c of components) {
    const n = num(c.ids?.uid);
    if (n != null && n >= base && n < base + 1000) used.add(n);
  }
  for (let k = 1; k < 1000; k += 1) {
    if (!used.has(base + k)) return String(base + k);
  }
  return String(base + 999);
}

/** Next free `{prefix}{nn}` UID for a device block. */
export function nextDeviceUid(prefix: string, usedUids: Iterable<string | undefined>): string {
  const used = new Set<number>();
  for (const uid of usedUids) {
    if (uid && uid.startsWith(prefix)) {
      const n = parseInt(uid.slice(prefix.length), 10);
      if (!Number.isNaN(n)) used.add(n);
    }
  }
  for (let i = 1; i < 100; i += 1) {
    if (!used.has(i)) return `${prefix}${String(i).padStart(2, '0')}`;
  }
  return `${prefix}99`;
}

/* ---------- spec parsing ---------- */

/** Split a "Name — detail" spec into a concise name + trailing detail. */
export function splitSpec(spec: string): { name: string; detail: string } {
  const sep = (spec ?? '').match(/\s+[—–]\s+/);
  if (!sep || sep.index == null) return { name: (spec ?? '').trim(), detail: '' };
  return {
    name: spec.slice(0, sep.index).trim(),
    detail: spec.slice(sep.index + sep[0].length).trim(),
  };
}

const COMPONENT_BRANDS = [
  'Thermal Grizzly', 'Cooler Master', 'Western Digital', 'SK hynix', 'Lian Li',
  'G.SKILL', 'TEAMGROUP', 'Thermalright', 'Sabrent', 'Phanteks', 'Deepcool', 'SilverStone',
  'AMD', 'Intel', 'NVIDIA', 'MSI', 'ASUS', 'ASRock', 'Gigabyte', 'Corsair', 'CORSAIR',
  'Crucial', 'Samsung', 'Seagate', 'Toshiba', 'HGST', 'WDC', 'WD', 'Kingston', 'Micron',
  'Arctic', 'Noctua', 'NZXT', 'Antec', 'Fractal', 'Realtek', 'Powerspec', 'Lenovo', 'HP',
  'TP-Link', 'Netgear', 'Cisco', 'Ubiquiti', 'ADATA', 'Patriot', 'EVGA', 'PNY', 'Zotac',
  'Palit', 'Sapphire', 'XFX', 'Gainward',
];

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Detect the left-most known brand in a spec string. */
export function detectBrand(text: string): string | undefined {
  const t = text ?? '';
  let best: string | undefined;
  let bestIdx = Infinity;
  for (const b of COMPONENT_BRANDS) {
    const idx = t.search(new RegExp(`(?:^|\\b)${escRe(b)}\\b`, 'i'));
    if (idx >= 0 && (idx < bestIdx || (idx === bestIdx && b.length > (best?.length ?? 0)))) {
      bestIdx = idx;
      best = b;
    }
  }
  return best;
}

/** Detect how many physical units a spec describes, e.g. "(2×16 GB)" → 2. */
export function splitMultiUnit(spec: string): { count: number; perUnit?: string } {
  const m = (spec ?? '').match(/(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(GB|TB)/i);
  if (!m) return { count: 1 };
  const count = parseInt(m[1], 10);
  if (!count || count < 2) return { count: 1 };
  return { count, perUnit: `${m[2]} ${m[3].toUpperCase()}` };
}

interface Extractor {
  label: string;
  types: ComponentType[] | '*';
  re: RegExp;
  fmt?: (m: RegExpMatchArray) => string;
}

const EXTRACTORS: Extractor[] = [
  { label: 'Socket',      types: ['cpu', 'motherboard'], re: /\b(AM[45]|LGA\s?\d+(?:-v\d+)?|sTRX?4|TR4|FM2\+?)\b/i },
  { label: 'Chipset',     types: ['motherboard'],        re: /\b([XBZH]\d{3}[A-Z]?)\b/ },
  { label: 'Timing',      types: ['ram'],                re: /\bCL(\d+)\b/i, fmt: (m) => `CL${m[1]}` },
  { label: 'Voltage',     types: ['ram'],                re: /\b(\d\.\d+)\s*V\b/i, fmt: (m) => `${m[1]} V` },
  { label: 'Profile',     types: ['ram'],                re: /\b(AMD EXPO|EXPO|Intel XMP|XMP)\b/i },
  { label: 'VRAM',        types: ['gpu'],                re: /\b(\d+(?:\.\d+)?)\s*(GB|MB)\b/i, fmt: (m) => `${m[1]} ${m[2].toUpperCase()}` },
  { label: 'Capacity',    types: ['ram', 'storage'],     re: /\b(\d+(?:\.\d+)?)\s*(GB|TB)\b/i, fmt: (m) => `${m[1]} ${m[2].toUpperCase()}` },
  { label: 'Form Factor', types: ['storage', 'motherboard', 'case'], re: /\b(2\.5"|3\.5"|M\.2|E-ATX|Micro-ATX|Mini-ITX|ATX|SFF)\b/i },
  { label: 'Interface',   types: ['storage'],            re: /\b(NVMe|SATA(?:\s?6\s?Gb\/s)?|PCIe[^,;]*)\b/i },
  { label: 'Wattage',     types: ['psu'],                re: /\b(\d{3,4})\s*W\b/i, fmt: (m) => `${m[1]} W` },
  { label: 'Speed',       types: ['nic'],                re: /\b(\d+(?:\.\d+)?\s*(?:GbE|Gbps|Gbit|MbE|Mbps))\b/i },
];

/** Best-effort parse of a free-text spec into labeled fields for a given type.
 *  The seed authors fields directly; this is mainly for migrating saved data. */
export function parseSpecToFields(type: ComponentType, spec: string): SpecField[] {
  const { name, detail } = splitSpec(spec);
  const brand = detectBrand(spec);
  let model = name;
  if (brand) model = name.replace(new RegExp(`^\\s*${escRe(brand)}\\s*`, 'i'), '').trim();

  const fields: SpecField[] = [];
  if (brand) fields.push(field('Brand', brand));
  if (model) fields.push(field('Model', model));

  const seen = new Set(fields.map((f) => f.label));
  // Specs live after the dash; consume matches out of `work` so leftovers → Notes.
  let work = detail || '';

  // Cores / Threads (one match → two fields).
  if (type === 'cpu') {
    const ct = work.match(/(\d+)\s*C\s*\/\s*(\d+)\s*T/i);
    if (ct) {
      fields.push(field('Cores', ct[1]));
      fields.push(field('Threads', ct[2]));
      seen.add('Cores'); seen.add('Threads');
      work = work.replace(ct[0], '');
    }
  }

  // DDR generation + speed (overlapping → handled together).
  if (type === 'ram') {
    const ddr = work.match(/\bDDR(\d)[A-Z]*(?:[\s-]?(\d{3,5}))?\b/i);
    if (ddr) {
      fields.push(field('Type', `DDR${ddr[1]}`));
      seen.add('Type');
      if (ddr[2]) { fields.push(field('Speed', `${ddr[2]} MT/s`)); seen.add('Speed'); }
      work = work.replace(ddr[0], '');
    }
  }

  for (const ex of EXTRACTORS) {
    if (ex.types !== '*' && !ex.types.includes(type)) continue;
    if (seen.has(ex.label)) continue;
    const mm = work.match(ex.re);
    if (!mm) continue;
    fields.push(field(ex.label, ex.fmt ? ex.fmt(mm) : mm[1] ?? mm[0]));
    seen.add(ex.label);
    work = work.replace(mm[0], '');
  }

  const notes = work
    .split(/\s*[,;]\s*/)
    .map((s) => s.trim().replace(/^\(|\)$/g, '').trim())
    .filter((s) => s && !/^[—–-]+$/.test(s));
  if (notes.length) fields.push(field('Notes', notes.join(', ')));

  if (fields.length === 0 && spec.trim()) fields.push(field('Spec', spec.trim()));
  return fields;
}

/** Read a field value by label (case-insensitive). */
export function fieldValue(fields: SpecField[], label: string): string | undefined {
  return fields.find((f) => f.label.toLowerCase() === label.toLowerCase())?.value || undefined;
}

/** Short display name for a component (Brand + Model, else label). */
export function componentTitle(c: Component): string {
  const brand = fieldValue(c.fields, 'Brand');
  const model = fieldValue(c.fields, 'Model');
  if (brand && model) return `${brand} ${model}`;
  if (model) return model;
  if (brand) return brand;
  return c.label;
}

/* ---------- seed (from markdown) ---------- */

const m = (label: string, value: string): MetaRow => ({ id: genId('m'), label, value });

interface SeedComp {
  type: ComponentType;
  label: string;
  fields: Record<string, string>;
  rawSpec?: string;
  ids?: ItemIds;
}

function toFields(rec: Record<string, string>): SpecField[] {
  return Object.entries(rec)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([label, value]) => field(label, value));
}

function makeSeed(): Inventory {
  const example: Machine = {
    id: genId('mach'), ordinal: '01', name: 'Example PC', role: 'Windows workstation',
    deployment: 'in-service',
    meta: [m('Hostname', 'EXAMPLE-WORKSTATION'), m('IP', '198.51.100.10'), m('OS', 'Microsoft Windows 11 Pro')],
  };
  const obi: Machine = {
    id: genId('mach'), ordinal: '02', name: 'OBI PC', role: 'Windows workstation',
    deployment: 'in-service',
    meta: [m('Hostname', 'EXAMPLE-PC'), m('Domain', 'example.test'), m('IP', '198.51.100.10'), m('OS', 'Microsoft Windows 11 Pro')],
  };
  const grey: Machine = {
    id: genId('mach'), ordinal: '03', name: 'example-server', role: 'Proxmox host',
    deployment: 'in-service',
    meta: [m('Hostname', 'example-server'), m('IP', '198.51.100.10'), m('OS', 'Proxmox VE 9 (Debian 13 "Trixie")')],
  };
  const nas: Machine = {
    id: genId('mach'), ordinal: '04', name: 'NAS NAS', role: 'Network-attached storage',
    deployment: 'in-service',
    meta: [
      m('Brand / Model', 'Ubiquiti UniFi UNAS 4 (4-bay)'), m('IP', '198.51.100.10'),
      m('NIC', '2.5 GbE RJ45 (PoE+++ powered)'), m('USB', 'USB-C 5 Gbps'),
      m('Wireless', 'Bluetooth 4.1'), m('Display', '1.47" color LCM'), m('Power', '90 W PoE+++'),
    ],
  };
  const purple: Machine = {
    id: genId('mach'), ordinal: '05', name: 'node-b', role: 'Proxmox host',
    deployment: 'in-service',
    meta: [m('Hostname', 'node-b'), m('IP', '198.51.100.10'), m('OS', 'Proxmox VE 9'), m('Model', 'Lenovo ThinkCentre M920q Tiny')],
    ids: { serial: 'SERIAL-EXAMPLE-001', assetTag: 'ASSET-EXAMPLE-001' },
  };
  const blue: Machine = {
    id: genId('mach'), ordinal: '06', name: 'node-c', role: 'Proxmox host',
    deployment: 'in-service',
    meta: [m('Hostname', 'node-c'), m('IP', '198.51.100.10'), m('OS', 'Proxmox VE 9'), m('Model', 'Lenovo ThinkCentre M910q Tiny')],
    ids: { serial: 'SERIAL-EXAMPLE-002', assetTag: 'ASSET-EXAMPLE-002' },
  };
  const machines = [example, obi, grey, nas, purple, blue];

  const comps: Array<{ machine: string } & SeedComp> = [
    // Example PC
    { machine: example.id, type: 'cpu',  label: 'CPU', fields: { Brand: 'AMD', Model: 'Ryzen 9 9950X3D', Cores: '16', Threads: '32', Socket: 'AM5' } },
    { machine: example.id, type: 'cooler', label: 'CPU Cooler', fields: { Brand: 'Arctic', Model: 'Liquid Freezer III 420', Type: 'AIO', Size: '420 mm', Notes: 'Non-RGB' } },
    { machine: example.id, type: 'gpu',  label: 'GPU', fields: { Brand: 'MSI', Model: 'Inspire 3X OC GeForce RTX 5070 Ti', VRAM: '16 GB' } },
    { machine: example.id, type: 'motherboard', label: 'Motherboard', fields: { Brand: 'ASUS', Model: 'TUF Gaming X870-PLUS WiFi', Socket: 'AM5', Chipset: 'X870', 'Form Factor': 'ATX' } },
    { machine: example.id, type: 'ram',  label: 'RAM 1', fields: { Brand: 'G.SKILL', Model: 'Trident Z5 Neo RGB', Type: 'DDR5', Speed: '6000 MT/s', Capacity: '16 GB', Timing: 'CL30', Voltage: '1.35 V', Profile: 'AMD EXPO' } },
    { machine: example.id, type: 'ram',  label: 'RAM 2', fields: { Brand: 'G.SKILL', Model: 'Trident Z5 Neo RGB', Type: 'DDR5', Speed: '6000 MT/s', Capacity: '16 GB', Timing: 'CL30', Voltage: '1.35 V', Profile: 'AMD EXPO' } },
    { machine: example.id, type: 'storage', label: 'Storage 1', fields: { Brand: 'Samsung', Model: '990 Pro', Capacity: '2 TB', 'Form Factor': 'M.2', Interface: 'NVMe' } },
    { machine: example.id, type: 'storage', label: 'Storage 2', fields: { Brand: 'Samsung', Model: '980', Capacity: '1 TB', 'Form Factor': 'M.2', Interface: 'NVMe' } },
    { machine: example.id, type: 'psu',  label: 'PSU', fields: { Brand: 'CORSAIR', Model: 'RM850e (2025)', Wattage: '850 W' } },
    { machine: example.id, type: 'case', label: 'Case', fields: { Brand: 'Antec', Model: 'FLUX Wood', 'Form Factor': 'Mid-Tower E-ATX', Notes: 'walnut wood front, 5× PWM fans, Type-C' } },
    { machine: example.id, type: 'cooler', label: 'Thermal Paste', fields: { Brand: 'Thermal Grizzly', Model: 'Kryonaut' } },
    { machine: example.id, type: 'nic',  label: 'NIC', fields: { Brand: 'Realtek', Speed: '2.5 GbE', Notes: 'onboard' } },
    // OBI PC
    { machine: obi.id, type: 'cpu',  label: 'CPU', fields: { Brand: 'AMD', Model: 'Ryzen 7 7700X', Cores: '8', Threads: '16', Socket: 'AM5' } },
    { machine: obi.id, type: 'cooler', label: 'CPU Cooler', fields: { Brand: 'Cooler Master', Model: '240 mm AIO', Type: 'AIO', Size: '240 mm' } },
    { machine: obi.id, type: 'gpu',  label: 'GPU', fields: { Brand: 'MSI', Model: 'NVIDIA GeForce RTX 3070', VRAM: '8 GB' } },
    { machine: obi.id, type: 'motherboard', label: 'Motherboard', fields: { Brand: 'ASUS', Model: 'TUF Gaming B650-PLUS WiFi', Socket: 'AM5', Chipset: 'B650' } },
    { machine: obi.id, type: 'ram',  label: 'RAM 1', fields: { Brand: 'G.SKILL', Model: 'F5-6000J3636F16G', Type: 'DDR5', Speed: '6000 MT/s', Capacity: '16 GB' } },
    { machine: obi.id, type: 'ram',  label: 'RAM 2', fields: { Brand: 'G.SKILL', Model: 'F5-6000J3636F16G', Type: 'DDR5', Speed: '6000 MT/s', Capacity: '16 GB' } },
    { machine: obi.id, type: 'storage', label: 'Storage 1', fields: { Brand: 'Crucial', Model: 'CT500P310SSD8', Capacity: '500 GB', Interface: 'NVMe' } },
    { machine: obi.id, type: 'psu',  label: 'PSU', fields: { Brand: 'CORSAIR', Model: '750 W', Wattage: '750 W' } },
    { machine: obi.id, type: 'case', label: 'Case', fields: { Brand: 'NZXT', Model: 'H5 Flow (2023)' } },
    { machine: obi.id, type: 'cooler', label: 'Thermal Paste', fields: { Brand: 'Thermal Grizzly', Model: 'Kryonaut' } },
    { machine: obi.id, type: 'nic',  label: 'NIC', fields: { Brand: 'Realtek', Speed: '2.5 GbE', Notes: 'onboard' } },
    // example-server
    { machine: grey.id, type: 'cpu',  label: 'CPU', fields: { Brand: 'AMD', Model: 'Ryzen 7 3700X', Cores: '8', Threads: '16', Socket: 'AM4' } },
    { machine: grey.id, type: 'cooler', label: 'CPU Cooler', fields: { Brand: 'Thermalright', Model: 'Phantom Spirit 120 SE Black', Type: 'dual-tower air', Notes: '7 heat pipes, 2× TL-C12B V2' } },
    { machine: grey.id, type: 'gpu',  label: 'GPU', fields: { Brand: 'NVIDIA', Model: 'GeForce GTX 1080 Ti', VRAM: '11 GB' } },
    { machine: grey.id, type: 'motherboard', label: 'Motherboard', fields: { Brand: 'MSI', Model: 'MAG B550 Tomahawk', Socket: 'AM4', Chipset: 'B550' } },
    { machine: grey.id, type: 'ram',  label: 'RAM 1', fields: { Brand: 'G.SKILL', Model: 'Ripjaws V', Type: 'DDR4', Speed: '3600 MT/s', Capacity: '16 GB', Timing: 'CL18', Profile: 'XMP', Notes: 'F4-3600C18D-32GVK kit' } },
    { machine: grey.id, type: 'ram',  label: 'RAM 2', fields: { Brand: 'G.SKILL', Model: 'Ripjaws V', Type: 'DDR4', Speed: '3600 MT/s', Capacity: '16 GB', Timing: 'CL18', Profile: 'XMP', Notes: 'F4-3600C18D-32GVK kit' } },
    { machine: grey.id, type: 'ram',  label: 'RAM 3', fields: { Brand: 'G.SKILL', Model: 'Ripjaws V', Type: 'DDR4', Speed: '3600 MT/s', Capacity: '16 GB', Timing: 'CL18', Profile: 'XMP', Notes: 'F4-3600C18D-32GVK kit' } },
    { machine: grey.id, type: 'ram',  label: 'RAM 4', fields: { Brand: 'G.SKILL', Model: 'Ripjaws V', Type: 'DDR4', Speed: '3600 MT/s', Capacity: '16 GB', Timing: 'CL18', Profile: 'XMP', Notes: 'F4-3600C18D-32GVK kit' } },
    { machine: grey.id, type: 'storage', label: 'Storage 1', fields: { Brand: 'Crucial', Model: 'CT1000P310SSD8', Capacity: '1 TB', Interface: 'NVMe' } },
    { machine: grey.id, type: 'storage', label: 'Storage 2', fields: { Brand: 'Crucial', Model: 'CT2000BX500SSD1', Capacity: '2 TB', 'Form Factor': '2.5"', Interface: 'SATA' } },
    { machine: grey.id, type: 'storage', label: 'Storage 3', fields: { Brand: 'Toshiba', Model: 'DT01ACA200', Capacity: '2 TB', 'Form Factor': '3.5"', Interface: 'SATA' } },
    { machine: grey.id, type: 'psu',  label: 'PSU', fields: { Brand: 'Powerspec', Model: '750 W ATX', Wattage: '750 W', Modular: 'Non-Modular' } },
    { machine: grey.id, type: 'case', label: 'Case', fields: { Brand: 'NZXT', Model: 'H510i' } },
    { machine: grey.id, type: 'cooler', label: 'Thermal Paste', fields: { Brand: 'Thermal Grizzly', Model: 'Kryonaut' } },
    { machine: grey.id, type: 'nic',  label: 'NIC 1', fields: { Brand: 'Realtek', Model: 'RTL8125', Speed: '2.5 GbE', Notes: 'onboard' } },
    { machine: grey.id, type: 'nic',  label: 'NIC 2', fields: { Brand: 'Realtek', Model: 'RTL8111/8168', Speed: '1 GbE', Notes: 'onboard' } },
    // NAS NAS
    { machine: nas.id, type: 'cpu',  label: 'CPU', fields: { Model: 'Quad-core ARM Cortex-A55', Notes: '@ 1.7 GHz' } },
    { machine: nas.id, type: 'ram',  label: 'RAM', fields: { Capacity: '4 GB', Notes: 'soldered' } },
    { machine: nas.id, type: 'storage', label: 'Drive Bay 1', fields: { Brand: 'WD Red Plus', Model: 'WD40EFPX-68C6CN0', Capacity: '4 TB', 'Form Factor': '3.5"', Interface: 'SATA' } },
    { machine: nas.id, type: 'storage', label: 'Drive Bay 2', fields: { Brand: 'WD Purple', Model: 'WD60PURX-64LZMY0', Capacity: '6 TB', 'Form Factor': '3.5"', Interface: 'SATA', Notes: 'surveillance' } },
    { machine: nas.id, type: 'storage', label: 'Drive Bay 3', fields: { Brand: 'WD Blue', Model: 'WD5000LPVX-08V0TT5', Capacity: '500 GB', 'Form Factor': '2.5"', Interface: 'SATA' } },
    { machine: nas.id, type: 'storage', label: 'Drive Bay 4', fields: { Brand: 'HGST', Model: 'HTS725050A7E630', Capacity: '500 GB', 'Form Factor': '2.5"', Interface: 'SATA' } },
    { machine: nas.id, type: 'storage', label: 'NVMe Slot 1', fields: { Brand: 'WDC', Model: 'PC SN720 SDAQNTW', Capacity: '512 GB', 'Form Factor': 'M.2', Interface: 'NVMe' } },
    // node-b
    { machine: purple.id, type: 'cpu',  label: 'CPU', fields: { Brand: 'Intel', Model: '8th-gen Core (T-series)', Socket: 'LGA1151' } },
    { machine: purple.id, type: 'ram',  label: 'RAM 1', fields: { Brand: 'Micron', Model: 'MTA8ATF1G64HZ-2G6E1', Type: 'DDR4', Speed: '2666 MT/s', Capacity: '8 GB', 'Form Factor': 'SO-DIMM', Notes: 'Lenovo FRU 01AG841' } },
    { machine: purple.id, type: 'ram',  label: 'RAM 2', fields: { Brand: 'SK hynix', Model: 'HMA81GS6AFR8N-UH', Type: 'DDR4', Speed: '2400 MT/s', Capacity: '8 GB', 'Form Factor': 'SO-DIMM', Notes: 'runs at 2400 MT/s — slower module sets the bus' } },
    { machine: purple.id, type: 'storage', label: 'Storage 1', fields: { Brand: 'Samsung', Model: 'PM981 (MZ-VLB2560)', Capacity: '256 GB', 'Form Factor': 'M.2', Interface: 'NVMe' } },
    { machine: purple.id, type: 'case', label: 'Chassis', fields: { Brand: 'Lenovo', Model: 'ThinkCentre M920q Tiny', Notes: 'MTM ASSET-EXAMPLE-001, 20 V / 3.25 A' } },
    { machine: purple.id, type: 'nic',  label: 'NIC', fields: { Speed: '1 GbE', Notes: 'onboard' } },
    // node-c
    { machine: blue.id, type: 'cpu',  label: 'CPU', fields: { Brand: 'Intel', Model: '6th/7th-gen Core (T-series)', Socket: 'LGA1151' } },
    { machine: blue.id, type: 'ram',  label: 'RAM 1', fields: { Brand: 'SK hynix', Model: 'HMA81GS6CJR8N-VK', Type: 'DDR4', Speed: '2666 MT/s', Capacity: '8 GB', 'Form Factor': 'SO-DIMM', Notes: 'Lenovo FRU 01AG824, factory' } },
    { machine: blue.id, type: 'ram',  label: 'RAM 2', fields: { Brand: 'SK hynix', Model: 'HMA851S6AFR6N-UH', Type: 'DDR4', Speed: '2400 MT/s', Capacity: '4 GB', 'Form Factor': 'SO-DIMM', Notes: 'runs at 2400 MT/s — slower module sets the bus' } },
    { machine: blue.id, type: 'storage', label: 'Storage 1', fields: { Brand: 'Samsung', Model: 'PM961 (MZ-VLW2560)', Capacity: '256 GB', 'Form Factor': 'M.2', Interface: 'NVMe', Notes: 'Lenovo FRU 00UP436' } },
    { machine: blue.id, type: 'case', label: 'Chassis', fields: { Brand: 'Lenovo', Model: 'ThinkCentre M910q Tiny', Notes: 'MTM 10MU / S08B00, MFG 04/2018, 20 V / 3.25 A' } },
    { machine: blue.id, type: 'nic',  label: 'NIC', fields: { Speed: '1 GbE', Notes: 'onboard' } },
    // Spare components (dissolved from the old component categories)
    { machine: SPARE, type: 'cpu',  label: 'CPU', fields: { Brand: 'Intel', Model: 'Core i7-5820K', Cores: '6', Socket: 'LGA 2011-v3' } },
    { machine: SPARE, type: 'cooler', label: 'CPU Cooler', fields: { Brand: 'AMD', Model: 'Wraith Prism', Type: 'air', Notes: 'Stock cooler, RGB' } },
    { machine: SPARE, type: 'cooler', label: 'CPU Cooler', fields: { Brand: 'AMD', Model: 'Wraith Stealth', Type: 'air', Notes: 'Stock cooler' } },
    { machine: SPARE, type: 'storage', label: 'SSD', fields: { Brand: 'Samsung', Model: '850 EVO', Capacity: '250 GB', 'Form Factor': '2.5"', Interface: 'SATA' } },
    { machine: SPARE, type: 'storage', label: 'SSD', fields: { Brand: 'Kingston', Model: 'RBU-SNS4151S3/16GD', Capacity: '16 GB', Notes: 'OEM SSD' } },
    { machine: SPARE, type: 'storage', label: 'HDD', fields: { Brand: 'Seagate', Model: 'ST1000LM035 (Mobile HDD)', Capacity: '1 TB', 'Form Factor': '2.5"' }, rawSpec: 'serial SERIAL-EXAMPLE-003 · part PART-EXAMPLE-001' },
    { machine: SPARE, type: 'storage', label: 'HDD', fields: { Brand: 'WD Blue', Model: 'WD5000LPVX-08V0T', Capacity: '500 GB', 'Form Factor': '2.5"', Interface: 'SATA 6Gb/s', Notes: '5400 RPM' } },
    { machine: SPARE, type: 'storage', label: 'HDD', fields: { Brand: 'WD Purple', Model: 'WD40PURX-64GVNY0', Capacity: '4 TB', 'Form Factor': '3.5"' } },
    { machine: SPARE, type: 'ram',  label: 'RAM', fields: { Brand: 'SK hynix', Model: 'HMT351S6EFR8A', Capacity: '4 GB', Type: 'DDR3L', Speed: '1600 MT/s', 'Form Factor': 'SO-DIMM', Notes: 'PC3L-12800S, 2Rx8' } },
    { machine: SPARE, type: 'ram',  label: 'RAM', fields: { Brand: 'Samsung', Model: 'M471A5644EB0-CPB', Capacity: '2 GB', Type: 'DDR4', Speed: '2133 MT/s', 'Form Factor': 'SO-DIMM', Notes: 'PC4-2133P, 1Rx16' } },
  ];

  // The WD Purple spare drive is the known-broken one (failed SMART).
  const components: Component[] = comps.map((c) => {
    const comp: Component = {
      id: genId('comp'),
      type: c.type,
      label: c.label,
      fields: toFields(c.fields),
      assignment: c.machine,
      rawSpec: c.rawSpec,
    };
    if (c.ids) comp.ids = { ...c.ids };
    if (c.machine === SPARE && c.type === 'storage' && c.fields.Model === 'WD40PURX-64GVNY0') {
      comp.status = 'broken';
      comp.problemLog = [{ id: genId('p'), date: '2026-05-30', note: 'Bad sectors detected, end of life — failed its SMART test.' }];
    }
    if (c.machine === SPARE && c.fields.Model === 'ST1000LM035 (Mobile HDD)') {
      comp.ids = { serial: 'SERIAL-EXAMPLE-003', part: 'PART-EXAMPLE-001' };
    }
    return comp;
  });

  const dev = (
    values: Record<string, string>,
    extra: Partial<SpareItem> = {},
  ): SpareItem => ({ id: genId('s'), deployment: 'spare', values, ...extra });

  const spares: SpareCategory[] = [
    {
      id: genId('cat'), name: 'Network', deviceType: 'network', prefix: '04',
      note: 'Active Ubiquiti gear powering the network.',
      columns: [
        { id: 'role', label: 'Role' }, { id: 'brand', label: 'Brand' },
        { id: 'model', label: 'Model' }, { id: 'notes', label: 'Features' },
        { id: 'qty', label: 'Qty', align: 'right' },
      ],
      items: [
        dev({ role: 'Gateway / Router', brand: 'Ubiquiti', model: 'UCG-Fiber (UniFi Cloud Gateway Fiber)', notes: 'Multi-gig fiber gateway', qty: '1' }, { name: 'Gateway Gateway', deployment: 'in-service' }),
        dev({ role: 'Switch', brand: 'Ubiquiti', model: 'USW-Flex-2.5G-5 (Flex 2.5G 5-port)', notes: '2.5 GbE, 5 ports', qty: '1' }, { name: 'SwitchA-Switch', deployment: 'in-service' }),
        dev({ role: 'Switch', brand: 'Ubiquiti', model: 'USW-Flex-2.5G-5 (Flex 2.5G 5-port)', notes: '2.5 GbE, 5 ports', qty: '1' }, { name: 'SwitchB-Switch', deployment: 'in-service' }),
        dev({ role: 'Switch', brand: 'Ubiquiti', model: 'USW-Pro-Max-16-PoE (Pro Max 16 PoE)', notes: '16-port multi-gig PoE', qty: '1' }, { name: 'Switch Switch PoE', deployment: 'in-service' }),
        dev({ role: 'Wi-Fi AP', brand: 'Ubiquiti', model: 'U7-Pro-XG', notes: 'Wi-Fi 7, 10 GbE uplink', qty: '1' }, { name: 'AccessPoint AP', deployment: 'in-service' }),
      ],
    },
    {
      id: genId('cat'), name: 'Cameras', deviceType: 'camera', prefix: '07',
      columns: [
        { id: 'role', label: 'Role' }, { id: 'brand', label: 'Brand' },
        { id: 'model', label: 'Model' }, { id: 'notes', label: 'Features' },
      ],
      items: [
        dev({ role: 'Camera', brand: 'Ubiquiti', model: 'UVC-G6-Bullet (Protect G6 Bullet)', notes: 'PoE bullet security cam' }, { name: 'Outside-Left', deployment: 'in-service' }),
      ],
    },
    {
      id: genId('cat'), name: 'Laptops', deviceType: 'laptop', prefix: '01',
      columns: [
        { id: 'brand', label: 'Brand' }, { id: 'model', label: 'Model' },
        { id: 'cpu', label: 'CPU' }, { id: 'ram', label: 'RAM' }, { id: 'storage', label: 'Storage' },
      ],
      items: [
        dev({ brand: 'Apple', model: 'MacBook Air (M1)', cpu: 'Apple M1', ram: '8 GB', storage: '256 GB' }),
        dev({ brand: 'Apple', model: 'MacBook Pro 15" 2017 (Touch Bar)', cpu: 'Intel Core i7', ram: '16 GB', storage: '1 TB' }),
        dev({ brand: 'Lenovo', model: 'ThinkPad T440', cpu: 'Verify on boot (Intel 4th-gen Core)', ram: 'Verify on boot', storage: 'Verify on boot' }),
        dev({ brand: 'Lenovo', model: 'ThinkPad T470s', cpu: 'Verify on boot (Intel 7th-gen Core)', ram: 'Verify on boot', storage: 'Verify on boot' }),
        dev({ brand: 'Lenovo', model: 'ThinkPad T480', cpu: 'Verify on boot (Intel 8th-gen Core)', ram: 'Verify on boot', storage: 'Verify on boot' }),
      ],
    },
    {
      id: genId('cat'), name: 'Phones', deviceType: 'phone', prefix: '02',
      columns: [{ id: 'brand', label: 'Brand' }, { id: 'model', label: 'Model' }, { id: 'notes', label: 'Features' }],
      items: [],
    },
    {
      id: genId('cat'), name: 'Networking (legacy)', deviceType: 'network', prefix: '04',
      note: 'Earlier networking gear retained as spares.',
      columns: [
        { id: 'brand', label: 'Brand' }, { id: 'model', label: 'Model' },
        { id: 'type', label: 'Type' }, { id: 'notes', label: 'Features' },
      ],
      items: [
        dev({ brand: 'Cisco', model: 'FPR-1010 (Firepower 1010)', type: 'Next-gen firewall / security appliance', notes: 'PID: FPR-1010 V01, 8× 1 GbE + mgmt, SN JMX2726X1SC, mfg 06/29/2023, Made in Mexico' }),
        dev({ brand: 'ASUS', model: 'RT-AX3000', type: 'Wi-Fi 6 router', notes: '' }),
        dev({ brand: 'TP-Link', model: 'TL-SG108E', type: '8-port managed switch (1 GbE)', notes: 'Easy Smart, QoS / VLAN / IGMP / LAG' }),
        dev({ brand: 'Netgear', model: 'GS308', type: '8-port unmanaged switch (1 GbE)', notes: '' }),
        dev({ brand: 'Netgear', model: 'GS608', type: '8-port unmanaged switch (1 GbE)', notes: '' }),
        dev({ brand: 'Netgear', model: 'FS726TP ProSafe', type: '24-port smart switch (10/100) + 2× 1 GbE', notes: 'PoE' }),
        dev({ brand: '(Generic)', model: 'PS1080', type: '8-port PoE unmanaged switch (1 GbE)', notes: 'IEEE 802.3af, 100–240 VAC input, 48 VDC output' }),
      ],
    },
    {
      id: genId('cat'), name: 'Printers', deviceType: 'printer', prefix: '03',
      columns: [{ id: 'brand', label: 'Brand' }, { id: 'model', label: 'Model' }, { id: 'type', label: 'Type' }, { id: 'notes', label: 'Features' }],
      items: [
        dev({ brand: 'HP', model: 'DeskJet 4255e', type: 'All-in-one inkjet (print/scan/copy)', notes: 'Wi-Fi' }),
      ],
    },
  ];

  return { lastUpdated: '2026-06-01', machines, components, spares };
}

/* ---------- storage ---------- */

const STORAGE_KEY = 'inventory';
const SCHEMA_VERSION = 7;

interface Persisted {
  v: number;
  data: Inventory;
}

/* ---------- migration ---------- */

function cloneInventory<T>(data: T): T {
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

function ensureDetail<T extends ItemDetail>(item: T): void {
  if (!item.status) item.status = 'working';
  if (!item.purchase) item.purchase = {};
  if (!item.ids) item.ids = {};
  if (!item.problemLog) item.problemLog = [];
}

/** old → new UID mapping recorded during the last v6→v7 migration (for relabeling). */
export interface UidMapEntry { old: string; new: string; label: string; }
let _lastUidMap: UidMapEntry[] = [];
export function getLastUidMap(): UidMapEntry[] {
  return _lastUidMap;
}

/** Old v6 shapes (machines embed components; spares mix component + device cats). */
interface OldSpecRow extends ItemDetail { id: string; component: string; specification: string; }
interface OldMachine extends ItemDetail { id: string; name: string; role: string; ordinal?: string; meta: MetaRow[]; components?: OldSpecRow[]; }
interface OldSpareItem extends ItemDetail { id: string; values: Record<string, string>; }
interface OldSpareCategory { id: string; name: string; note?: string; prefix?: string; kind?: string; columns: SpareColumn[]; items: OldSpareItem[]; }
interface OldInventory { lastUpdated: string; machines: OldMachine[]; spares: OldSpareCategory[]; components?: unknown; }

function isOldShape(data: Inventory | OldInventory): data is OldInventory {
  if (!Array.isArray((data as Inventory).components)) return true;
  return (data.machines as OldMachine[]).some((m) => Array.isArray(m.components));
}

const COMPONENT_CATEGORY = /^(cpus?|cpu coolers?|coolers?|gpus?|ssds?|hdds?|hard\s*drives?|ram|memory|motherboards?|psus?|power supplies)$/i;

function migrateV6toV7(old: OldInventory): Inventory {
  const map: UidMapEntry[] = [];
  const components: Component[] = [];

  const machines: Machine[] = (old.machines ?? []).map((om, i) => {
    const uid = `${MACHINE_BLOCK}${String(i + 1).padStart(2, '0')}`;
    const oldUid = om.ids?.uid;
    map.push({ old: oldUid || om.name, new: uid, label: om.name });
    const machine: Machine = {
      id: om.id, name: om.name, role: om.role, ordinal: om.ordinal,
      deployment: 'in-service', meta: om.meta ?? [],
      status: om.status, purchase: om.purchase,
      ids: { ...(om.ids ?? {}), uid }, problemLog: om.problemLog,
    };
    ensureDetail(machine);

    for (const row of om.components ?? []) {
      const type = detectComponentType(row.component, row.specification);
      const { count, perUnit } = splitMultiUnit(row.specification);
      for (let u = 0; u < count; u += 1) {
        const fields = parseSpecToFields(type, row.specification);
        if (count > 1 && perUnit) {
          const cap = fields.find((f) => f.label === 'Capacity');
          if (cap) cap.value = perUnit;
        }
        const uidc = nextComponentUid(type, components);
        const label = count > 1 ? `${normalizeBaseLabel(row.component)} ${u + 1}` : row.component;
        const comp: Component = {
          id: u === 0 ? row.id : genId('comp'),
          type, label, fields, rawSpec: row.specification, assignment: om.id,
          status: u === 0 ? row.status : 'working',
          purchase: u === 0 ? row.purchase : {},
          ids: { ...(u === 0 ? row.ids ?? {} : {}), uid: uidc },
          problemLog: u === 0 ? row.problemLog : [],
        };
        ensureDetail(comp);
        components.push(comp);
        map.push({ old: row.ids?.uid || `${om.name}/${row.component}`, new: uidc, label: `${row.component}${count > 1 ? ` ${u + 1}` : ''}` });
      }
    }
    return machine;
  });

  const spares: SpareCategory[] = [];
  for (const cat of old.spares ?? []) {
    if (COMPONENT_CATEGORY.test(cat.name.trim())) {
      // Dissolve component categories into the pool as spares.
      const type = detectComponentType(cat.name);
      for (const it of cat.items) {
        const spec = [it.values.brand, it.values.model, it.values.part, it.values.capacity, it.values.type, it.values.form, it.values.notes]
          .filter(Boolean).join(' ');
        const fields = valuesToFields(it.values, cat.columns);
        const uidc = nextComponentUid(type, components);
        const comp: Component = {
          id: it.id, type, label: COMPONENT_TYPE_LABELS[type], fields, rawSpec: spec,
          assignment: SPARE, status: it.status, purchase: it.purchase,
          ids: { ...(it.ids ?? {}), uid: uidc }, problemLog: it.problemLog,
        };
        ensureDetail(comp);
        components.push(comp);
        map.push({ old: it.ids?.uid || it.id, new: uidc, label: it.values.model || cat.name });
      }
      continue;
    }
    // Device category — keep, classify, renumber, inject names / deployment.
    const deviceType = cat.kind === 'network' ? 'network' : detectDeviceType(cat.name);
    const prefix = DEVICE_BLOCKS[deviceType];
    // Only the explicitly-active category (the old kind:'network') is deployed;
    // "Networking (legacy)" and every other device category default to spare.
    const activeCategory = cat.kind === 'network';
    // Don't carry vendor-specific category names (e.g. "UniFi Network Infrastructure").
    const catName = /unifi/i.test(cat.name) ? 'Network' : cat.name;
    const cameraItems: SpareItem[] = [];
    const keptItems: SpareItem[] = [];
    // Expand qty>1 identical gear into separate named units (e.g. the 2× USW-Flex
    // → SwitchA-Switch + SwitchB-Switch); other items pass through as a single unit.
    interface Unit { src: OldSpareItem; name?: string; first: boolean; values: Record<string, string>; }
    const units: Unit[] = [];
    for (const it of cat.items) {
      const model = stripModel(it.values.model ?? '');
      const splitNames = activeCategory ? NETWORK_SPLIT[model] : undefined;
      const qty = parseInt(it.values.qty ?? '1', 10) || 1;
      if (splitNames && qty > 1) {
        for (let i = 0; i < qty; i += 1) {
          units.push({ src: it, name: splitNames[i], first: i === 0, values: { ...it.values, qty: '1' } });
        }
      } else {
        units.push({ src: it, name: NETWORK_NAMES[model], first: true, values: it.values });
      }
    }
    for (const u of units) {
      const it = u.src;
      const model = u.values.model ?? '';
      const isCamera = /camera|bullet|protect|uvc/i.test(`${model} ${u.values.role ?? ''}`);
      const target = (isCamera && activeCategory) ? cameraItems : keptItems;
      const block = (isCamera && activeCategory) ? DEVICE_BLOCKS.camera : prefix;
      const uid = nextDeviceUid(block, [
        ...allDeviceUids(spares),
        ...keptItems.map((t) => t.ids?.uid),
        ...cameraItems.map((t) => t.ids?.uid),
      ]);
      const item: SpareItem = {
        id: u.first ? it.id : genId('s'),
        values: u.values,
        name: u.name ?? (isCamera ? 'Camera' : undefined),
        deployment: activeCategory ? 'in-service' : 'spare',
        status: u.first ? it.status : 'working',
        purchase: u.first ? it.purchase : {},
        ids: { ...(u.first ? it.ids ?? {} : {}), uid }, problemLog: u.first ? it.problemLog : [],
      };
      ensureDetail(item);
      target.push(item);
      map.push({ old: it.ids?.uid || it.id, new: uid, label: u.name ?? model });
    }
    spares.push({
      id: cat.id, name: catName, note: cat.note, prefix, deviceType,
      columns: cat.columns, items: keptItems,
    });
    if (cameraItems.length) {
      spares.push({
        id: genId('cat'), name: 'Cameras', deviceType: 'camera', prefix: DEVICE_BLOCKS.camera,
        columns: cat.columns, items: cameraItems,
      });
    }
  }

  _lastUidMap = map;
  return { lastUpdated: old.lastUpdated ?? '2026-06-01', machines, components, spares };
}

function normalizeBaseLabel(label: string): string {
  return label.replace(/\s*\(.*?\)\s*$/, '').replace(/\s*\d+\s*$/, '').trim() || label;
}

function stripModel(model: string): string {
  return model.split('(')[0].trim();
}

/** Identical multi-unit gear (qty>1) → one friendly name per physical unit. */
const NETWORK_SPLIT: Record<string, string[]> = {
  'USW-Flex-2.5G-5': ['SwitchA-Switch', 'SwitchB-Switch'],
};

/** Known UniFi gear → friendly name (used when migrating existing saved data). */
const NETWORK_NAMES: Record<string, string> = {
  'UCG-Fiber': 'Gateway Gateway',
  'USW-Pro-Max-16-PoE': 'Switch Switch PoE',
  'U7-Pro-XG': 'AccessPoint AP',
  'UVC-G6-Bullet': 'Outside-Left',
};

function allDeviceUids(spares: SpareCategory[]): Array<string | undefined> {
  return spares.flatMap((c) => c.items.map((it) => it.ids?.uid));
}

function valuesToFields(values: Record<string, string>, columns: SpareColumn[]): SpecField[] {
  const labelFor = (id: string) => columns.find((c) => c.id === id)?.label ?? id;
  return Object.entries(values)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([id, v]) => field(/^notes$/i.test(id) ? 'Notes' : labelFor(id), v));
}

/** Fill defaults / assign any missing UIDs on an already-v7 inventory. */
function ensureNew(data: Inventory): Inventory {
  const inv = cloneInventory(data);
  if (!Array.isArray(inv.machines)) inv.machines = [];
  if (!Array.isArray(inv.components)) inv.components = [];
  if (!Array.isArray(inv.spares)) inv.spares = [];

  for (const machine of inv.machines) {
    if (!machine.deployment) machine.deployment = 'in-service';
    ensureDetail(machine);
    if (!machine.ids!.uid) {
      machine.ids!.uid = nextDeviceUid(MACHINE_BLOCK, inv.machines.map((m) => m.ids?.uid));
    }
  }
  for (const comp of inv.components) {
    if (!comp.type) comp.type = detectComponentType(comp.label, comp.rawSpec);
    if (!comp.assignment) comp.assignment = SPARE;
    if (!Array.isArray(comp.fields)) comp.fields = [];
    ensureDetail(comp);
    if (!comp.ids!.uid) comp.ids!.uid = nextComponentUid(comp.type, inv.components);
  }
  for (const cat of inv.spares) {
    if (!cat.deviceType) cat.deviceType = cat.kind === 'network' ? 'network' : detectDeviceType(cat.name);
    if (!cat.prefix) cat.prefix = DEVICE_BLOCKS[cat.deviceType];
    for (const it of cat.items) {
      if (!it.deployment) it.deployment = cat.deviceType === 'network' ? 'in-service' : 'spare';
      ensureDetail(it);
      if (!it.ids!.uid) it.ids!.uid = nextDeviceUid(cat.prefix!, allDeviceUids(inv.spares));
    }
  }
  return inv;
}

export function migrateInventory(data: Inventory | OldInventory): Inventory {
  if (isOldShape(data)) return ensureNew(migrateV6toV7(data));
  return ensureNew(data as Inventory);
}

/* ---------- load / save ---------- */

export function loadInventory(): Inventory {
  const persisted = getState<Persisted | null>(STORAGE_KEY, null);
  if (!persisted?.data) {
    // First boot: render the seed AND materialize it into the database so the
    // server (SQLite) becomes the single, complete source of truth. Skip the
    // write when the backend is unreachable (degraded).
    const seeded = migrateInventory(makeSeed());
    if (!isDegraded()) saveInventory(seeded);
    return seeded;
  }
  if (persisted.v < SCHEMA_VERSION) {
    const migrated = migrateInventory(persisted.data);
    saveInventory(migrated);
    return migrated;
  }
  if (persisted.v > SCHEMA_VERSION) {
    if (typeof console !== 'undefined') {
      console.warn(
        `[inventory] persisted v=${persisted.v} > supported v=${SCHEMA_VERSION}; ` +
        `rendering preserved data without saving. Upgrade the app to write back.`,
      );
    }
    return migrateInventory(persisted.data);
  }
  return migrateInventory(persisted.data);
}

export function saveInventory(inv: Inventory): void {
  const payload: Persisted = { v: SCHEMA_VERSION, data: inv };
  setState<Persisted>(STORAGE_KEY, payload);
}

export function resetInventory(): Inventory {
  const fresh = migrateInventory(makeSeed());
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
    return migrateInventory(candidate as Inventory | OldInventory);
  } catch {
    return null;
  }
}

/* ---------- item lookup ---------- */

export type FoundItem =
  | { kind: 'machine';   machine: Machine }
  | { kind: 'spare';     item: SpareItem; category: SpareCategory }
  | { kind: 'component'; component: Component; machine: Machine | null };

export function findItem(inv: Inventory, id: string): FoundItem | null {
  const machine = inv.machines.find((mm) => mm.id === id);
  if (machine) return { kind: 'machine', machine };
  const comp = inv.components.find((c) => c.id === id);
  if (comp) {
    const owner = comp.assignment === SPARE ? null : (inv.machines.find((mm) => mm.id === comp.assignment) ?? null);
    return { kind: 'component', component: comp, machine: owner };
  }
  for (const cat of inv.spares) {
    const it = cat.items.find((x) => x.id === id);
    if (it) return { kind: 'spare', item: it, category: cat };
  }
  return null;
}

/** Components installed in a machine. */
export function machineComponents(inv: Inventory, machineId: string): Component[] {
  return inv.components.filter((c) => c.assignment === machineId);
}

/* ---------- summary stats ---------- */

export interface InventoryStats {
  machineCount: number;
  componentCount: number;
  installedComponentCount: number;
  spareComponentCount: number;
  deviceCategoryCount: number;
  deviceItemCount: number;
  networkItemCount: number;
}

export function summarize(inv: Inventory): InventoryStats {
  let installed = 0;
  let spare = 0;
  for (const c of inv.components) {
    if (c.assignment === SPARE) spare += 1; else installed += 1;
  }
  let deviceItems = 0;
  let networkItems = 0;
  for (const cat of inv.spares) {
    deviceItems += cat.items.length;
    if (cat.deviceType === 'network') networkItems += cat.items.length;
  }
  return {
    machineCount: inv.machines.length,
    componentCount: inv.components.length,
    installedComponentCount: installed,
    spareComponentCount: spare,
    deviceCategoryCount: inv.spares.length,
    deviceItemCount: deviceItems,
    networkItemCount: networkItems,
  };
}
