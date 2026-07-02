import {
  COMPONENT_BLOCKS,
  COMPONENT_TYPE_LABELS,
  detectComponentType,
  type ComponentType,
} from './component-registry';
import { genId } from './inventory-id';
import {
  createSpecField,
  fieldValue,
  parseSpecToFields,
  splitMultiUnit,
  type SpecField,
} from './inventory-spec-parser';
import { getState, setState } from './store';

export {
  COMPONENT_BLOCKS,
  COMPONENT_TYPE_FIELDS,
  COMPONENT_TYPE_LABELS,
  COMPONENT_TYPE_ORDER,
  COMPONENT_TYPE_REGISTRY,
  detectComponentType,
  type ComponentType,
  type ComponentTypeDefinition,
} from './component-registry';
export { genId } from './inventory-id';
export {
  detectBrand,
  fieldValue,
  parseSpecToFields,
  splitMultiUnit,
  splitSpec,
  type SpecField,
} from './inventory-spec-parser';

export interface MetaRow {
  id: string;
  label: string;
  value: string;
}

export type ItemStatus = 'working' | 'broken' | 'in-repair' | 'retired';

export type Deployment = 'in-service' | 'spare';

export interface PurchaseInfo {
  date?: string;
  vendor?: string;
  price?: string;
  receiptRef?: string;
  warrantyEnd?: string;
}

export interface ItemIds {
  serial?: string;

  part?: string;
  uid?: string;
  mac?: string;
  assetTag?: string;
  location?: string;
}

export interface ProblemLogEntry {
  id: string;
  date: string;
  note: string;
}

export interface ItemImage {
  id: string;
  w: number;
  h: number;
}

export type ItemIcon =
  { kind: 'image'; id: string; w: number; h: number } | { kind: 'dashboard'; name: string };

export const MAX_IMAGES_PER_ITEM = 6;

export interface ItemDetail {
  status?: ItemStatus;
  purchase?: PurchaseInfo;
  ids?: ItemIds;
  problemLog?: ProblemLogEntry[];

  icon?: ItemIcon;
  images?: ItemImage[];
}

export const SPARE = 'spare';

export interface Component extends ItemDetail {
  id: string;
  type: ComponentType;

  label: string;
  fields: SpecField[];

  rawSpec?: string;

  assignment: string;
}

export interface Machine extends ItemDetail {
  id: string;
  name: string;
  role: string;

  ordinal?: string;
  deployment: Deployment;
  meta: MetaRow[];
}

export type DeviceCategoryType =
  'laptop' | 'phone' | 'printer' | 'network' | 'peripheral' | 'monitor' | 'camera' | 'other';

export interface Device extends ItemDetail {
  id: string;

  name?: string;
  deployment: Deployment;

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

  prefix?: string;

  deviceType?: DeviceCategoryType;
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

export const MACHINE_BLOCK = '08';

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

export function componentTitle(c: Component): string {
  const brand = fieldValue(c.fields, 'Brand');
  const model = fieldValue(c.fields, 'Model');
  if (brand && model) return `${brand} ${model}`;
  if (model) return model;
  if (brand) return brand;
  return c.label;
}

export function emptyInventory(): Inventory {
  return { lastUpdated: '', machines: [], components: [], devices: [] };
}

const STORAGE_KEY = 'inventory';

const SCHEMA_VERSION = 11;

interface Persisted {
  v: number;
  data: Inventory;
}

function cloneInventory<T>(data: T): T {
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

function normalizeIcon(icon: unknown): ItemIcon | undefined {
  if (typeof icon !== 'object' || icon === null || Array.isArray(icon)) return undefined;
  const record = icon as Record<string, unknown>;
  if (record.kind === 'image' && typeof record.id === 'string' && record.id.trim()) {
    const id = record.id.trim();
    const w = typeof record.w === 'number' && Number.isFinite(record.w) ? record.w : 0;
    const h = typeof record.h === 'number' && Number.isFinite(record.h) ? record.h : 0;
    return { kind: 'image', id, w, h };
  }
  if (record.kind === 'dashboard' && typeof record.name === 'string') {
    const name = record.name.trim().toLowerCase();
    if (name) return { kind: 'dashboard', name };
  }
  return undefined;
}

function ensureDetail<T extends ItemDetail>(item: T): void {
  if (!item.status) item.status = 'working';
  if (!item.purchase) item.purchase = {};
  if (!item.ids) item.ids = {};
  if (!item.problemLog) item.problemLog = [];
  item.icon = normalizeIcon(item.icon);
  if (!Array.isArray(item.images)) item.images = [];
}

export interface UidMapEntry {
  old: string;
  new: string;
  label: string;
}
let _lastUidMap: UidMapEntry[] = [];
export function getLastUidMap(): UidMapEntry[] {
  return _lastUidMap;
}

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

    const deviceType = cat.kind === 'network' ? 'network' : detectDeviceType(cat.name);
    const prefix = DEVICE_BLOCKS[deviceType];

    const activeCategory = cat.kind === 'network';

    const catName =
      cat.name === 'Networking (legacy)'
        ? 'Networking'
        : /unifi/i.test(cat.name)
          ? 'Network'
          : cat.name;
    const cameraItems: Device[] = [];
    const keptItems: Device[] = [];

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

const NETWORK_SPLIT: Record<string, string[]> = {
  'USW-FX-X': ['Access Switch 1', 'Access Switch 2'],
};

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
    .map(([id, v]) => createSpecField(/^notes$/i.test(id) ? 'Notes' : labelFor(id), v));
}

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

export function machineComponents(inv: Inventory, machineId: string): Component[] {
  return inv.components.filter((c) => c.assignment === machineId);
}

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
