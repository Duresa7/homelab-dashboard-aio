export type Section =
  | 'overview'
  | 'proxmox'
  | 'network'
  | 'docker'
  | 'nas'
  | 'cameras'
  | 'events'
  | 'alerts'
  | 'health'
  | 'siem'
  | 'inventory'
  | 'playground'
  | 'settings';

export interface Route {
  section: Section;
  sub?: string;
  /** Optional item id for inventory detail panel. */
  itemId?: string;
}

interface PersistedRoute {
  section?: Section | 'storage';
  sub?: string;
  itemId?: string;
}

export interface SubDef {
  id: string;
  label: string;
}

export const SUBS: Partial<Record<Section, SubDef[]>> = {
  proxmox: [
    { id: 'compute',  label: 'Compute' },
    { id: 'guests',   label: 'Guests' },
    { id: 'storage',  label: 'Storage' },
    { id: 'sensors',  label: 'Sensors' },
  ],
  network: [
    { id: 'overview', label: 'Overview' },
    { id: 'devices',  label: 'Devices' },
    { id: 'clients',  label: 'Clients' },
    { id: 'config',   label: 'Config' },
  ],
  docker: [
    { id: 'hosts',      label: 'Hosts' },
    { id: 'containers', label: 'Containers' },
  ],
  nas: [
    { id: 'pools', label: 'Pools' },
    { id: 'disks', label: 'Disks' },
  ],
  cameras: [
    { id: 'overview', label: 'Overview' },
    { id: 'grid',     label: 'Live Grid' },
    { id: 'events',   label: 'Events' },
    { id: 'devices',  label: 'Devices' },
  ],
};

export const DEFAULT_SUB: Record<Section, string | undefined> = {
  overview:  undefined,
  proxmox:   'compute',
  network:   'overview',
  docker:    'hosts',
  nas:       'pools',
  cameras:   'overview',
  events:    undefined,
  alerts:    undefined,
  health:    undefined,
  siem:      undefined,
  inventory: undefined,
  playground: undefined,
  settings:  undefined,
};

export const SECTION_LABEL: Record<Section, string> = {
  overview:  'Overview',
  proxmox:   'Proxmox',
  network:   'Network',
  docker:    'Docker',
  nas:       'NAS',
  cameras:   'Cameras',
  events:    'Events',
  alerts:    'Alerts',
  health:    'API Health',
  siem:      'SIEM',
  inventory: 'Inventory',
  playground: 'Playground',
  settings:  'Settings',
};

export function resolveSub(section: Section, sub?: string): string | undefined {
  const subs = SUBS[section];
  if (!subs || subs.length === 0) return undefined;
  if (sub && subs.some((s) => s.id === sub)) return sub;
  return DEFAULT_SUB[section];
}

export function subLabel(section: Section, sub: string): string {
  const subs = SUBS[section];
  return subs?.find((s) => s.id === sub)?.label ?? sub;
}

import { getState, setState } from './store';

const STORAGE_KEY = 'route';

function normalizeRoute(route: PersistedRoute): Route {
  const section: Section = route.section === 'storage' ? 'nas' : route.section ?? 'overview';
  const sub = section === 'proxmox' && route.sub === 'drives' ? 'storage' : route.sub;
  const itemId = section === 'inventory' ? route.itemId : undefined;
  return { section, sub: resolveSub(section, sub), itemId };
}

export function loadRoute(): Route {
  const parsed = getState<PersistedRoute | null>(STORAGE_KEY, null);
  if (!parsed?.section) return { section: 'overview' };
  return normalizeRoute(parsed);
}

export function saveRoute(r: Route): void {
  setState<Route>(STORAGE_KEY, r);
}
