import { genId, type Component, type Machine } from './inventory';
import { getState, setState } from './store';

export type SlotId =
  | 'cpu'
  | 'cooler'
  | 'mobo'
  | 'ram'
  | 'gpu'
  | 'storage1'
  | 'storage2'
  | 'psu'
  | 'case'
  | 'paste'
  | 'nic';

export interface SlotDef {
  id: SlotId;
  label: string;

  categoryMatch?: RegExp;

  componentMatch?: RegExp;

  required: boolean;

  isPsu?: boolean;
}

export const SLOT_DEFS: SlotDef[] = [
  { id: 'cpu', label: 'CPU', required: true, categoryMatch: /^cpus?$/i, componentMatch: /^cpu$/i },
  {
    id: 'cooler',
    label: 'CPU Cooler',
    required: true,
    categoryMatch: /cpu coolers?/i,
    componentMatch: /cpu cooler/i,
  },
  { id: 'mobo', label: 'Motherboard', required: true, componentMatch: /motherboard/i },
  { id: 'ram', label: 'RAM', required: true, categoryMatch: /^ram$/i, componentMatch: /^ram$/i },
  { id: 'gpu', label: 'GPU', required: false, componentMatch: /^gpu$/i },
  {
    id: 'storage1',
    label: 'Storage 1',
    required: true,
    categoryMatch: /^(ssds?|hdds?)$/i,
    componentMatch: /^storage 1$/i,
  },
  {
    id: 'storage2',
    label: 'Storage 2',
    required: false,
    categoryMatch: /^(ssds?|hdds?)$/i,
    componentMatch: /^storage 2$/i,
  },
  { id: 'psu', label: 'PSU', required: true, isPsu: true, componentMatch: /^psu$/i },
  { id: 'case', label: 'Case', required: true, componentMatch: /^case$/i },
  { id: 'paste', label: 'Thermal Paste', required: false, componentMatch: /thermal paste/i },
  { id: 'nic', label: 'NIC', required: false, componentMatch: /^nic( 1)?$/i },
];

export const SLOT_BY_ID: Record<SlotId, SlotDef> = SLOT_DEFS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<SlotId, SlotDef>,
);

export type SlotSource = 'empty' | 'spare' | 'machine-component' | 'custom';

export interface SlotEntry {
  source: SlotSource;

  spareId?: string;

  componentId?: string;

  customText?: string;

  watts?: number;
}

export interface PlaygroundBuild {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  slots: Record<SlotId, SlotEntry>;
}

export interface PlaygroundState {
  lastUpdated: string;
  builds: PlaygroundBuild[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptySlots(): Record<SlotId, SlotEntry> {
  const out = {} as Record<SlotId, SlotEntry>;
  for (const s of SLOT_DEFS) out[s.id] = { source: 'empty' };
  return out;
}

export function emptyBuild(name = 'New build'): PlaygroundBuild {
  const now = today();
  return {
    id: genId('build'),
    name,
    notes: '',
    createdAt: now,
    updatedAt: now,
    slots: emptySlots(),
  };
}

export function buildFromMachine(machine: Machine, components: Component[]): PlaygroundBuild {
  const build = emptyBuild(`${machine.name} (copy)`);
  for (const c of components) {
    for (const def of SLOT_DEFS) {
      if (def.componentMatch?.test(c.label) && build.slots[def.id].source === 'empty') {
        build.slots[def.id] = { source: 'machine-component', componentId: c.id };
        break;
      }
    }
  }
  return build;
}

const STORAGE_KEY = 'playground';
const SCHEMA_VERSION = 1;

interface Persisted {
  v: number;
  data: PlaygroundState;
}

function makeSeed(): PlaygroundState {
  return {
    lastUpdated: today(),
    builds: [emptyBuild('Example build')],
  };
}

function migrate(data: PlaygroundState): PlaygroundState {
  for (const b of data.builds) {
    if (!b.slots) b.slots = emptySlots();
    for (const def of SLOT_DEFS) {
      if (!b.slots[def.id]) b.slots[def.id] = { source: 'empty' };
    }
    if (!b.createdAt) b.createdAt = today();
    if (!b.updatedAt) b.updatedAt = b.createdAt;
  }
  return data;
}

export function loadPlayground(): PlaygroundState {
  const persisted = getState<Persisted | null>(STORAGE_KEY, null);
  if (!persisted?.data) return migrate(makeSeed());
  if (persisted.v < SCHEMA_VERSION) {
    const m = migrate(persisted.data);
    savePlayground(m);
    return m;
  }
  return migrate(persisted.data);
}

export function savePlayground(state: PlaygroundState): void {
  setState<Persisted>(STORAGE_KEY, { v: SCHEMA_VERSION, data: state });
}

export function resetPlayground(): PlaygroundState {
  const fresh = makeSeed();
  savePlayground(fresh);
  return fresh;
}

export function exportPlaygroundJSON(state: PlaygroundState): string {
  return JSON.stringify(
    { v: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: state },
    null,
    2,
  );
}

export function tryImportPlaygroundJSON(text: string): PlaygroundState | null {
  try {
    const parsed = JSON.parse(text) as { v?: number; data?: PlaygroundState } | PlaygroundState;
    const candidate = (parsed as { data?: PlaygroundState }).data ?? (parsed as PlaygroundState);
    if (!candidate || !Array.isArray((candidate as PlaygroundState).builds)) return null;
    return migrate(candidate as PlaygroundState);
  } catch {
    return null;
  }
}

const PSU_HEADROOM = 0.85;

export interface BuildStatus {
  missing: SlotId[];
  filled: number;
  required: number;
  powerDraw: number;
  psuRating: number;
  powerPct: number;
  powerOk: boolean;
}

export function computeBuildStatus(build: PlaygroundBuild): BuildStatus {
  const missing: SlotId[] = [];
  let filled = 0;
  let required = 0;
  let powerDraw = 0;
  let psuRating = 0;

  for (const def of SLOT_DEFS) {
    const entry = build.slots[def.id];
    if (def.required) required += 1;
    if (entry.source !== 'empty') {
      if (def.required) filled += 1;
    } else if (def.required) {
      missing.push(def.id);
    }
    if (def.isPsu) {
      psuRating = entry.watts ?? 0;
    } else if (entry.source !== 'empty' && typeof entry.watts === 'number') {
      powerDraw += entry.watts;
    }
  }

  const powerPct = psuRating > 0 ? (powerDraw / psuRating) * 100 : 0;
  const powerOk = psuRating === 0 || powerDraw <= psuRating * PSU_HEADROOM;

  return { missing, filled, required, powerDraw, psuRating, powerPct, powerOk };
}
