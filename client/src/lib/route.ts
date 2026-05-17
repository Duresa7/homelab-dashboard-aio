export type Section =
  | 'overview'
  | 'proxmox'
  | 'network'
  | 'docker'
  | 'nas'
  | 'cameras'
  | 'events'
  | 'alerts'
  | 'settings';

export interface Route {
  section: Section;
  sub?: string;
}

interface PersistedRoute {
  section?: Section | 'storage';
  sub?: string;
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
  overview: undefined,
  proxmox:  'compute',
  network:  'overview',
  docker:   'hosts',
  nas:      'pools',
  cameras:  'overview',
  events:   undefined,
  alerts:   undefined,
  settings: undefined,
};

export const SECTION_LABEL: Record<Section, string> = {
  overview: 'Overview',
  proxmox:  'Proxmox',
  network:  'Network',
  docker:   'Docker',
  nas:      'NAS',
  cameras:  'Cameras',
  events:   'Events',
  alerts:   'Alerts',
  settings: 'Settings',
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

const STORAGE_KEY = 'homelab-dashboard.route';

function normalizeRoute(route: PersistedRoute): Route {
  const section: Section = route.section === 'storage' ? 'nas' : route.section ?? 'overview';
  const sub = section === 'proxmox' && route.sub === 'drives' ? 'storage' : route.sub;
  return { section, sub: resolveSub(section, sub) };
}

export function loadRoute(): Route {
  if (typeof window === 'undefined') return { section: 'overview' };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { section: 'overview' };
    const parsed = JSON.parse(raw) as PersistedRoute;
    if (!parsed.section) return { section: 'overview' };
    return normalizeRoute(parsed);
  } catch {
    return { section: 'overview' };
  }
}

export function saveRoute(r: Route): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}
