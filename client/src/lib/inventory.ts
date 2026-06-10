/* =========================================================
   Inventory — persistent tracker (v2 model).

   Two top-level entities:
   - `machines`     — active host chassis (PCs / servers / NAS). Block 08xx.
   - `components`   — ONE flat pool of parts (CPU/GPU/RAM/…). Each carries
                      structured `fields`, a type-block UID (CPU 1000, GPU 2000…),
                      and an `assignment` (a machine id, or the literal 'spare').
   - `devices`       — DEVICE categories only now (laptops 01, phones 02, printers
                      03, network 04, peripherals 05, monitors 06, cameras 07).
                      Each item has a per-item `deployment` (in-service|spare).

   Persisted via the server-backed store (lib/store.ts); user can edit,
   export/import, reset, and build their own inventory from an empty default.
   ========================================================= */

import { getState, setState } from './store';

export interface MetaRow {
  id: string;
  label: string;
  value: string;
}

export type ItemStatus = 'working' | 'broken' | 'in-repair' | 'retired';

/** Whether a part/device is deployed (in-service) or sitting in the drawer (spare). */
export type Deployment = 'in-service' | 'spare';

export interface PurchaseInfo {
  date?: string; // ISO yyyy-mm-dd
  vendor?: string;
  price?: string;
  receiptRef?: string;
  warrantyEnd?: string; // ISO yyyy-mm-dd
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
  date: string; // ISO yyyy-mm-dd
  note: string;
}

/** A photo attached to an item. The id addresses /api/images/:id (full) and
 * /api/images/:id/thumb; w/h are the stored full-variant dimensions. */
export interface ItemImage {
  id: string;
  w: number;
  h: number;
}

/** Most photos one item can carry (enforced in the editor UI; the server only
 * caps per-upload size since refs live inside the inventory blob). */
export const MAX_IMAGES_PER_ITEM = 6;

export interface ItemDetail {
  status?: ItemStatus;
  purchase?: PurchaseInfo;
  ids?: ItemIds;
  problemLog?: ProblemLogEntry[];
  /** Photos; the first one is the card thumbnail. */
  images?: ItemImage[];
}

/* ---------- components ---------- */

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

/* ---------- device categories (devices) ---------- */

export type DeviceCategoryType =
  | 'laptop'
  | 'phone'
  | 'printer'
  | 'network'
  | 'peripheral'
  | 'monitor'
  | 'camera'
  | 'other';

export interface Device extends ItemDetail {
  id: string;
  /** Friendly name (laptops + network gear). Falls back to model/brand for display. */
  name?: string;
  deployment: Deployment;
  /** Keyed by column id. */
  values: Record<string, string>;
}

export interface DeviceColumn {
  id: string;
  label: string;
  align?: 'left' | 'right';
}

export interface DeviceCategory {
  id: string;
  name: string;
  note?: string;
  /** 2-digit UID block, e.g. "01" → 0101, 0102… */
  prefix?: string;
  /** Canonical device kind (drives the block + icon). */
  deviceType?: DeviceCategoryType;
  /** @deprecated pre-v7 network split; superseded by deviceType. */
  kind?: 'spare' | 'network';
  columns: DeviceColumn[];
  items: Device[];
}

export interface Inventory {
  lastUpdated: string;
  machines: Machine[];
  components: Component[];
  devices: DeviceCategory[];
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
  cpu: 1000,
  gpu: 2000,
  motherboard: 3000,
  ram: 4000,
  storage: 5000,
  psu: 6000,
  cooler: 7000,
  case: 8000,
  nic: 9000,
  other: 10000,
};

/** Device category type → 2-digit UID block prefix. */
export const DEVICE_BLOCKS: Record<DeviceCategoryType, string> = {
  laptop: '01',
  phone: '02',
  printer: '03',
  network: '04',
  peripheral: '05',
  monitor: '06',
  camera: '07',
  other: '09',
};

/** Active machines (PCs / servers / NAS) all share this block. */
export const MACHINE_BLOCK = '08';

/** Default labeled fields offered when adding a component of each type. */
export const COMPONENT_TYPE_FIELDS: Record<ComponentType, string[]> = {
  cpu: ['Brand', 'Model', 'Cores', 'Threads', 'Socket', 'TDP'],
  gpu: ['Brand', 'Model', 'VRAM', 'Interface'],
  motherboard: ['Brand', 'Model', 'Socket', 'Chipset', 'Form Factor'],
  ram: ['Brand', 'Model', 'Type', 'Speed', 'Capacity', 'Timing', 'Voltage', 'Profile'],
  storage: ['Brand', 'Model', 'Capacity', 'Form Factor', 'Interface'],
  psu: ['Brand', 'Model', 'Wattage', 'Rating', 'Modular'],
  cooler: ['Brand', 'Model', 'Type', 'Size'],
  case: ['Brand', 'Model', 'Form Factor'],
  nic: ['Brand', 'Model', 'Speed', 'Interface'],
  other: ['Brand', 'Model'],
};

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  cpu: 'CPU',
  gpu: 'GPU',
  motherboard: 'Motherboard',
  ram: 'RAM',
  storage: 'Storage',
  psu: 'PSU',
  cooler: 'Cooler',
  case: 'Case',
  nic: 'NIC',
  other: 'Other',
};

export const DEVICE_TYPE_LABELS: Record<DeviceCategoryType, string> = {
  laptop: 'Laptops',
  phone: 'Phones',
  printer: 'Printers',
  network: 'Network',
  peripheral: 'Peripherals',
  monitor: 'Monitors',
  camera: 'Cameras',
  other: 'Devices',
};

/** Detect a canonical component type from its label (and optional spec text). */
export function detectComponentType(label: string, spec = ''): ComponentType {
  const k = `${label} ${spec}`.toLowerCase();
  if (/coolers?|\baio\b|heatsink|radiator|\bfans?\b|thermal\s*paste|\bpaste\b/.test(k))
    return 'cooler';
  if (/\bcpus?\b|processor/.test(k)) return 'cpu';
  if (/\bgpus?\b|graphics|geforce|radeon|video\s*card/.test(k)) return 'gpu';
  if (/motherboards?|mainboards?|\bmobo\b/.test(k)) return 'motherboard';
  if (/\bram\b|memory|dimm|dram/.test(k)) return 'ram';
  if (/storage|drive\s*bay|\bssds?\b|\bhdds?\b|\bnvme\b|m\.2|hard\s*drives?/.test(k))
    return 'storage';
  if (/\bpsus?\b|power\s*supply|power supplies/.test(k)) return 'psu';
  if (/\bcase\b|chassis|tower/.test(k)) return 'case';
  if (/\bnics?\b|ethernet|\blan\b|network\s*card/.test(k)) return 'nic';
  return 'other';
}

/** Detect a canonical device category type from a category name. */
export function detectDeviceType(name: string): DeviceCategoryType {
  const k = name.toLowerCase();
  if (/unifi|network|switch|router|gateway|firewall|wi[- ]?fi|\bap\b/.test(k)) return 'network';
  if (/laptop|notebook|macbook|thinkpad/.test(k)) return 'laptop';
  if (/phone|iphone|android|pixel|galaxy/.test(k)) return 'phone';
  if (/print/.test(k)) return 'printer';
  if (/camera|\bcam\b|protect|bullet/.test(k)) return 'camera';
  if (/monitor|display|screen/.test(k)) return 'monitor';
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
  'Thermal Grizzly',
  'Cooler Master',
  'Western Digital',
  'SK hynix',
  'Lian Li',
  'G.SKILL',
  'TEAMGROUP',
  'Thermalright',
  'Sabrent',
  'Phanteks',
  'Deepcool',
  'SilverStone',
  'AMD',
  'Intel',
  'NVIDIA',
  'MSI',
  'ASUS',
  'ASRock',
  'Gigabyte',
  'Corsair',
  'CORSAIR',
  'Crucial',
  'Samsung',
  'Seagate',
  'Toshiba',
  'HGST',
  'WDC',
  'WD',
  'Kingston',
  'Micron',
  'Arctic',
  'Noctua',
  'NZXT',
  'Antec',
  'Fractal',
  'Realtek',
  'Powerspec',
  'Lenovo',
  'HP',
  'TP-Link',
  'Netgear',
  'Cisco',
  'Ubiquiti',
  'ADATA',
  'Patriot',
  'EVGA',
  'PNY',
  'Zotac',
  'Palit',
  'Sapphire',
  'XFX',
  'Gainward',
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
  {
    label: 'Socket',
    types: ['cpu', 'motherboard'],
    re: /\b(AM[45]|LGA\s?\d+(?:-v\d+)?|sTRX?4|TR4|FM2\+?)\b/i,
  },
  { label: 'Chipset', types: ['motherboard'], re: /\b([XBZH]\d{3}[A-Z]?)\b/ },
  { label: 'Timing', types: ['ram'], re: /\bCL(\d+)\b/i, fmt: (m) => `CL${m[1]}` },
  { label: 'Voltage', types: ['ram'], re: /\b(\d\.\d+)\s*V\b/i, fmt: (m) => `${m[1]} V` },
  { label: 'Profile', types: ['ram'], re: /\b(AMD EXPO|EXPO|Intel XMP|XMP)\b/i },
  {
    label: 'VRAM',
    types: ['gpu'],
    re: /\b(\d+(?:\.\d+)?)\s*(GB|MB)\b/i,
    fmt: (m) => `${m[1]} ${m[2].toUpperCase()}`,
  },
  {
    label: 'Capacity',
    types: ['ram', 'storage'],
    re: /\b(\d+(?:\.\d+)?)\s*(GB|TB)\b/i,
    fmt: (m) => `${m[1]} ${m[2].toUpperCase()}`,
  },
  {
    label: 'Form Factor',
    types: ['storage', 'motherboard', 'case'],
    re: /\b(2\.5"|3\.5"|M\.2|E-ATX|Micro-ATX|Mini-ITX|ATX|SFF)\b/i,
  },
  { label: 'Interface', types: ['storage'], re: /\b(NVMe|SATA(?:\s?6\s?Gb\/s)?|PCIe[^,;]*)\b/i },
  { label: 'Wattage', types: ['psu'], re: /\b(\d{3,4})\s*W\b/i, fmt: (m) => `${m[1]} W` },
  { label: 'Speed', types: ['nic'], re: /\b(\d+(?:\.\d+)?\s*(?:GbE|Gbps|Gbit|MbE|Mbps))\b/i },
];

/** Best-effort parse of a free-text spec into labeled fields for a given type.
 *  Mainly for migrating saved data and imported inventory files. */
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
      seen.add('Cores');
      seen.add('Threads');
      work = work.replace(ct[0], '');
    }
  }

  // DDR generation + speed (overlapping → handled together).
  if (type === 'ram') {
    const ddr = work.match(/\bDDR(\d)[A-Z]*(?:[\s-]?(\d{3,5}))?\b/i);
    if (ddr) {
      fields.push(field('Type', `DDR${ddr[1]}`));
      seen.add('Type');
      if (ddr[2]) {
        fields.push(field('Speed', `${ddr[2]} MT/s`));
        seen.add('Speed');
      }
      work = work.replace(ddr[0], '');
    }
  }

  for (const ex of EXTRACTORS) {
    if (ex.types !== '*' && !ex.types.includes(type)) continue;
    if (seen.has(ex.label)) continue;
    const mm = work.match(ex.re);
    if (!mm) continue;
    fields.push(field(ex.label, ex.fmt ? ex.fmt(mm) : (mm[1] ?? mm[0])));
    seen.add(ex.label);
    work = work.replace(mm[0], '');
  }

  const notes = work
    .split(/\s*[,;]\s*/)
    .map((s) =>
      s
        .trim()
        .replace(/^\(|\)$/g, '')
        .trim(),
    )
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

/* ---------- defaults ---------- */

export function emptyInventory(): Inventory {
  return { lastUpdated: '', machines: [], components: [], devices: [] };
}

/* ---------- storage ---------- */

const STORAGE_KEY = 'inventory';
// v10: ItemDetail gains optional `images` (photo refs served by /api/images).
const SCHEMA_VERSION = 10;

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
  if (!Array.isArray(item.images)) item.images = [];
}

/** old → new UID mapping recorded during the last v6→v7 migration (for relabeling). */
export interface UidMapEntry {
  old: string;
  new: string;
  label: string;
}
let _lastUidMap: UidMapEntry[] = [];
export function getLastUidMap(): UidMapEntry[] {
  return _lastUidMap;
}

/** Old v6 shapes (machines embed components; spares mix component + device cats). */
interface OldSpecRow extends ItemDetail {
  id: string;
  component: string;
  specification: string;
}
interface OldMachine extends ItemDetail {
  id: string;
  name: string;
  role: string;
  ordinal?: string;
  meta: MetaRow[];
  components?: OldSpecRow[];
}
interface OldDeviceItem extends ItemDetail {
  id: string;
  values: Record<string, string>;
}
interface OldDeviceCategory {
  id: string;
  name: string;
  note?: string;
  prefix?: string;
  kind?: string;
  columns: DeviceColumn[];
  items: OldDeviceItem[];
}
interface OldInventory {
  lastUpdated: string;
  machines: OldMachine[];
  devices?: OldDeviceCategory[];
  spares?: OldDeviceCategory[];
  components?: unknown;
}

function isOldShape(data: Inventory | OldInventory): data is OldInventory {
  if (!Array.isArray((data as Inventory).components)) return true;
  return (data.machines as OldMachine[]).some((m) => Array.isArray(m.components));
}

const COMPONENT_CATEGORY =
  /^(cpus?|cpu coolers?|coolers?|gpus?|ssds?|hdds?|hard\s*drives?|ram|memory|motherboards?|psus?|power supplies)$/i;

function migrateV6toV7(old: OldInventory): Inventory {
  const map: UidMapEntry[] = [];
  const components: Component[] = [];

  const machines: Machine[] = (old.machines ?? []).map((om, i) => {
    const uid = `${MACHINE_BLOCK}${String(i + 1).padStart(2, '0')}`;
    const oldUid = om.ids?.uid;
    map.push({ old: oldUid || om.name, new: uid, label: om.name });
    const machine: Machine = {
      id: om.id,
      name: om.name,
      role: om.role,
      ordinal: om.ordinal,
      deployment: 'in-service',
      meta: om.meta ?? [],
      status: om.status,
      purchase: om.purchase,
      ids: { ...(om.ids ?? {}), uid },
      problemLog: om.problemLog,
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
          type,
          label,
          fields,
          rawSpec: row.specification,
          assignment: om.id,
          status: u === 0 ? row.status : 'working',
          purchase: u === 0 ? row.purchase : {},
          ids: { ...(u === 0 ? (row.ids ?? {}) : {}), uid: uidc },
          problemLog: u === 0 ? row.problemLog : [],
        };
        ensureDetail(comp);
        components.push(comp);
        map.push({
          old: row.ids?.uid || `${om.name}/${row.component}`,
          new: uidc,
          label: `${row.component}${count > 1 ? ` ${u + 1}` : ''}`,
        });
      }
    }
    return machine;
  });

  const devices: DeviceCategory[] = [];
  for (const cat of old.devices ?? old.spares ?? []) {
    if (COMPONENT_CATEGORY.test(cat.name.trim())) {
      // Dissolve component categories into the component pool as spares.
      const type = detectComponentType(cat.name);
      for (const it of cat.items) {
        const spec = [
          it.values.brand,
          it.values.model,
          it.values.part,
          it.values.capacity,
          it.values.type,
          it.values.form,
          it.values.notes,
        ]
          .filter(Boolean)
          .join(' ');
        const fields = valuesToFields(it.values, cat.columns);
        const uidc = nextComponentUid(type, components);
        const comp: Component = {
          id: it.id,
          type,
          label: COMPONENT_TYPE_LABELS[type],
          fields,
          rawSpec: spec,
          assignment: SPARE,
          status: it.status,
          purchase: it.purchase,
          ids: { ...(it.ids ?? {}), uid: uidc },
          problemLog: it.problemLog,
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
    // older spare-networking and every other device category default to spare.
    const activeCategory = cat.kind === 'network';
    // Don't carry vendor-specific category names (e.g. "UniFi Network Infrastructure").
    const catName =
      cat.name === 'Networking (legacy)'
        ? 'Networking'
        : /unifi/i.test(cat.name)
          ? 'Network'
          : cat.name;
    const cameraItems: Device[] = [];
    const keptItems: Device[] = [];
    // Expand qty>1 identical gear into separately named units; other items pass
    // through as a single unit.
    interface Unit {
      src: OldDeviceItem;
      name?: string;
      first: boolean;
      values: Record<string, string>;
    }
    const units: Unit[] = [];
    for (const it of cat.items) {
      const model = stripModel(it.values.model ?? '');
      const splitNames = activeCategory ? NETWORK_SPLIT[model] : undefined;
      const qty = parseInt(it.values.qty ?? '1', 10) || 1;
      if (splitNames && qty > 1) {
        for (let i = 0; i < qty; i += 1) {
          units.push({
            src: it,
            name: splitNames[i],
            first: i === 0,
            values: { ...it.values, qty: '1' },
          });
        }
      } else {
        units.push({ src: it, name: NETWORK_NAMES[model], first: true, values: it.values });
      }
    }
    for (const u of units) {
      const it = u.src;
      const model = u.values.model ?? '';
      const isCamera = /camera|bullet|protect|uvc/i.test(`${model} ${u.values.role ?? ''}`);
      const target = isCamera && activeCategory ? cameraItems : keptItems;
      const block = isCamera && activeCategory ? DEVICE_BLOCKS.camera : prefix;
      const uid = nextDeviceUid(block, [
        ...allDeviceUids(devices),
        ...keptItems.map((t) => t.ids?.uid),
        ...cameraItems.map((t) => t.ids?.uid),
      ]);
      const item: Device = {
        id: u.first ? it.id : genId('s'),
        values: u.values,
        name: u.name ?? (isCamera ? 'Camera' : undefined),
        deployment: activeCategory ? 'in-service' : 'spare',
        status: u.first ? it.status : 'working',
        purchase: u.first ? it.purchase : {},
        ids: { ...(u.first ? (it.ids ?? {}) : {}), uid },
        problemLog: u.first ? it.problemLog : [],
      };
      ensureDetail(item);
      target.push(item);
      map.push({ old: it.ids?.uid || it.id, new: uid, label: u.name ?? model });
    }
    devices.push({
      id: cat.id,
      name: catName,
      prefix,
      deviceType,
      columns: cat.columns,
      items: keptItems,
    });
    if (cameraItems.length) {
      devices.push({
        id: genId('cat'),
        name: 'Cameras',
        deviceType: 'camera',
        prefix: DEVICE_BLOCKS.camera,
        columns: cat.columns,
        items: cameraItems,
      });
    }
  }

  _lastUidMap = map;
  return { lastUpdated: old.lastUpdated ?? '2026-06-01', machines, components, devices };
}

function normalizeBaseLabel(label: string): string {
  return (
    label
      .replace(/\s*\(.*?\)\s*$/, '')
      .replace(/\s*\d+\s*$/, '')
      .trim() || label
  );
}

function stripModel(model: string): string {
  return model.split('(')[0].trim();
}

/** Identical multi-unit gear (qty>1) → one friendly name per physical unit. */
const NETWORK_SPLIT: Record<string, string[]> = {
  'USW-FX-X': ['Access Switch 1', 'Access Switch 2'],
};

/** Known UniFi gear → friendly name (used when migrating existing saved data). */
const NETWORK_NAMES: Record<string, string> = {
  'UCG-X': 'Gateway',
  'USW-PM-X': 'PoE Switch',
  'U7-X': 'Access Point',
  'UVC-X': 'Camera 1',
};

function allDeviceUids(devices: DeviceCategory[]): Array<string | undefined> {
  return devices.flatMap((c) => c.items.map((it) => it.ids?.uid));
}

function valuesToFields(values: Record<string, string>, columns: DeviceColumn[]): SpecField[] {
  const labelFor = (id: string) => columns.find((c) => c.id === id)?.label ?? id;
  return Object.entries(values)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([id, v]) => field(/^notes$/i.test(id) ? 'Notes' : labelFor(id), v));
}

/** Fill defaults / assign any missing UIDs on an already-v7 inventory. */
type MaybeLegacyDevices = Omit<Inventory, 'devices'> & {
  devices?: DeviceCategory[];
  spares?: DeviceCategory[];
};

function ensureNew(data: Inventory | MaybeLegacyDevices): Inventory {
  const inv = cloneInventory(data) as Inventory & { spares?: DeviceCategory[] };
  if (!Array.isArray(inv.devices) && Array.isArray(inv.spares)) {
    inv.devices = inv.spares;
  }
  delete inv.spares;
  if (!Array.isArray(inv.machines)) inv.machines = [];
  if (!Array.isArray(inv.components)) inv.components = [];
  if (!Array.isArray(inv.devices)) inv.devices = [];
  const renumberPrefixes = expandKnownQuantityDevices(inv);

  for (const machine of inv.machines) {
    if (!machine.deployment) machine.deployment = 'in-service';
    ensureDetail(machine);
    if (!machine.ids!.uid) {
      machine.ids!.uid = nextDeviceUid(
        MACHINE_BLOCK,
        inv.machines.map((m) => m.ids?.uid),
      );
    }
  }
  for (const comp of inv.components) {
    if (!comp.type) comp.type = detectComponentType(comp.label, comp.rawSpec);
    if (!comp.assignment) comp.assignment = SPARE;
    if (!Array.isArray(comp.fields)) comp.fields = [];
    ensureDetail(comp);
    if (!comp.ids!.uid) comp.ids!.uid = nextComponentUid(comp.type, inv.components);
  }
  for (const cat of inv.devices) {
    if (!cat.deviceType)
      cat.deviceType = cat.kind === 'network' ? 'network' : detectDeviceType(cat.name);
    if (!cat.prefix) cat.prefix = DEVICE_BLOCKS[cat.deviceType];
    for (const it of cat.items) {
      if (!it.deployment) it.deployment = cat.deviceType === 'network' ? 'in-service' : 'spare';
      ensureDetail(it);
      if (!it.ids!.uid) it.ids!.uid = nextDeviceUid(cat.prefix!, allDeviceUids(inv.devices));
    }
  }
  if (renumberPrefixes.size) renumberDevicePrefixes(inv, renumberPrefixes);
  return inv;
}

function expandKnownQuantityDevices(inv: Inventory): Set<string> {
  const renumberPrefixes = new Set<string>();
  for (const cat of inv.devices) {
    const deviceType =
      cat.deviceType ?? (cat.kind === 'network' ? 'network' : detectDeviceType(cat.name));
    const activeCategory = deviceType === 'network' && !/legacy/i.test(cat.name);
    const nextItems: Device[] = [];

    for (const it of cat.items ?? []) {
      const model = stripModel(it.values?.model ?? '');
      const splitNames = activeCategory ? NETWORK_SPLIT[model] : undefined;
      const qty = parseInt(it.values?.qty ?? '1', 10) || 1;
      if (!splitNames || qty <= 1) {
        nextItems.push(it);
        continue;
      }

      renumberPrefixes.add(cat.prefix ?? DEVICE_BLOCKS[deviceType]);
      for (let i = 0; i < qty; i += 1) {
        nextItems.push({
          ...it,
          id: i === 0 ? it.id : genId('s'),
          values: { ...it.values, qty: '1' },
          name: splitNames[i],
          status: i === 0 ? it.status : 'working',
          purchase: i === 0 ? it.purchase : {},
          ids: i === 0 ? { ...(it.ids ?? {}) } : {},
          problemLog: i === 0 ? it.problemLog : [],
        });
      }
    }

    cat.items = nextItems;
  }
  return renumberPrefixes;
}

function renumberDevicePrefixes(inv: Inventory, prefixes: Set<string>): void {
  const nextByPrefix = new Map<string, number>();
  for (const cat of inv.devices) {
    const prefix = cat.prefix ?? DEVICE_BLOCKS[cat.deviceType ?? detectDeviceType(cat.name)];
    if (!prefixes.has(prefix)) continue;
    for (const it of cat.items) {
      const next = nextByPrefix.get(prefix) ?? 1;
      it.ids = { ...(it.ids ?? {}), uid: `${prefix}${String(next).padStart(2, '0')}` };
      nextByPrefix.set(prefix, next + 1);
    }
  }
}

export function migrateInventory(data: Inventory | OldInventory | MaybeLegacyDevices): Inventory {
  if (isOldShape(data)) return ensureNew(migrateV6toV7(data));
  return ensureNew(data);
}

/* ---------- load / save ---------- */

export function loadInventory(): Inventory {
  const persisted = getState<Persisted | null>(STORAGE_KEY, null);
  if (!persisted?.data) {
    return emptyInventory();
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
  const fresh = emptyInventory();
  saveInventory(fresh);
  return fresh;
}

/* ---------- serialization helpers ---------- */

export function exportInventoryJSON(inv: Inventory): string {
  return JSON.stringify(
    { v: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: inv },
    null,
    2,
  );
}

export function tryImportInventoryJSON(text: string): Inventory | null {
  try {
    const parsed = JSON.parse(text) as { v?: number; data?: Inventory } | Inventory;
    const candidate = (parsed as { data?: Inventory }).data ?? (parsed as Inventory);
    if (
      !candidate ||
      !Array.isArray((candidate as Inventory).machines) ||
      (!Array.isArray((candidate as Inventory).devices) &&
        !Array.isArray((candidate as MaybeLegacyDevices).spares))
    ) {
      return null;
    }
    return migrateInventory(candidate as Inventory | OldInventory);
  } catch {
    return null;
  }
}

/* ---------- item lookup ---------- */

export type FoundItem =
  | { kind: 'machine'; machine: Machine }
  | { kind: 'spare'; item: Device; category: DeviceCategory }
  | { kind: 'component'; component: Component; machine: Machine | null };

export function findItem(inv: Inventory, id: string): FoundItem | null {
  const machine = inv.machines.find((mm) => mm.id === id);
  if (machine) return { kind: 'machine', machine };
  const comp = inv.components.find((c) => c.id === id);
  if (comp) {
    const owner =
      comp.assignment === SPARE
        ? null
        : (inv.machines.find((mm) => mm.id === comp.assignment) ?? null);
    return { kind: 'component', component: comp, machine: owner };
  }
  for (const cat of inv.devices) {
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
    if (c.assignment === SPARE) spare += 1;
    else installed += 1;
  }
  let deviceItems = 0;
  let networkItems = 0;
  for (const cat of inv.devices) {
    deviceItems += cat.items.length;
    if (cat.deviceType === 'network') networkItems += cat.items.length;
  }
  return {
    machineCount: inv.machines.length,
    componentCount: inv.components.length,
    installedComponentCount: installed,
    spareComponentCount: spare,
    deviceCategoryCount: inv.devices.length,
    deviceItemCount: deviceItems,
    networkItemCount: networkItems,
  };
}
