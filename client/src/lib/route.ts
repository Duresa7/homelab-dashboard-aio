import type { DashboardState } from '../types';

export type Section =
  | 'overview'
  | 'proxmox'
  | 'network'
  | 'docker'
  | 'nas'
  | 'observability'
  | 'inventory'
  | 'playground'
  | 'settings';

/** Legacy top-level sections folded into Observability tabs (for route migration). */
const OBSERVABILITY_LEGACY: Record<string, string> = {
  events: 'events',
  alerts: 'alerts',
  health: 'health',
  siem: 'siem',
};

export interface Route {
  section: Section;
  sub?: string;
  /** Optional item id for inventory detail panel. */
  itemId?: string;
}

interface PersistedRoute {
  section?: Section | 'storage' | string;
  sub?: string;
  itemId?: string;
}

export interface SubDef {
  id: string;
  label: string;
}

export const SUBS: Partial<Record<Section, SubDef[]>> = {
  proxmox: [
    { id: 'summary', label: 'Summary' },
    { id: 'guests', label: 'Guests' },
    { id: 'storage', label: 'Storage' },
    { id: 'disks', label: 'Disks/ZFS' },
    { id: 'sensors', label: 'Sensors' },
  ],
  network: [
    { id: 'overview', label: 'Overview' },
    { id: 'devices', label: 'Devices' },
    { id: 'clients', label: 'Clients' },
    { id: 'config', label: 'Config' },
  ],
  docker: [
    { id: 'hosts', label: 'Hosts' },
    { id: 'containers', label: 'Containers' },
  ],
  nas: [
    { id: 'pools', label: 'Pools' },
    { id: 'disks', label: 'Disks' },
  ],
  observability: [
    { id: 'alerts', label: 'Alerts' },
    { id: 'events', label: 'Events' },
    { id: 'siem', label: 'SIEM' },
    { id: 'health', label: 'API Health' },
  ],
};

export const DEFAULT_SUB: Record<Section, string | undefined> = {
  overview: undefined,
  proxmox: 'summary',
  network: 'overview',
  docker: 'hosts',
  nas: 'pools',
  observability: 'alerts',
  inventory: undefined,
  playground: undefined,
  settings: undefined,
};

export const SECTION_LABEL: Record<Section, string> = {
  overview: 'Overview',
  proxmox: 'Data Center',
  network: 'Network',
  docker: 'Docker',
  nas: 'NAS',
  observability: 'Observability',
  inventory: 'Inventory',
  playground: 'Playground',
  settings: 'Settings',
};

export function resolveSub(section: Section, sub?: string): string | undefined {
  if (section === 'proxmox') return resolveProxmoxSub(undefined, sub);
  const subs = SUBS[section];
  if (!subs || subs.length === 0) return undefined;
  if (sub && subs.some((s) => s.id === sub)) return sub;
  return DEFAULT_SUB[section];
}

export function proxmoxEntityType(itemId?: string): 'datacenter' | 'node' | 'guest' | 'storage' {
  if (!itemId || itemId === 'datacenter') return 'datacenter';
  if (itemId.startsWith('node/')) return 'node';
  if (itemId.startsWith('guest/')) return 'guest';
  if (itemId.startsWith('storage/')) return 'storage';
  return 'datacenter';
}

/** The bare entity name encoded in a proxmox itemId, e.g. `node/pve1` → `pve1`. */
export function entityName(itemId?: string): string {
  return itemId && itemId.includes('/')
    ? decodeURIComponent(itemId.split('/').slice(1).join('/'))
    : 'datacenter';
}

/**
 * Resolve the *display* name for a drilled-in proxmox itemId, mirroring the
 * lookups in the Data Center detail views so the global Topbar breadcrumb
 * matches the in-page DetailHeader title. Returns null at datacenter level.
 */
export function resolveProxmoxEntityName(data: DashboardState, itemId?: string): string | null {
  const key = entityName(itemId);
  switch (proxmoxEntityType(itemId)) {
    case 'node':
      return (data.proxmox.nodes.find((n) => n.name === key) ?? data.proxmox.node)?.name ?? key;
    case 'guest':
      return data.proxmox.vms.find((v) => String(v.id) === key)?.name ?? key;
    case 'storage':
      return (
        (
          data.proxmox.storages.find((s) => (s.shared ? s.name : `${s.node}:${s.name}`) === key) ??
          data.proxmox.storages.find((s) => s.name === key)
        )?.name ?? key
      );
    default:
      return null;
  }
}

export function normalizeProxmoxItemId(itemId?: string): string {
  if (!itemId || itemId === 'datacenter') return 'datacenter';
  if (/^(node|guest|storage)\/[^/]+$/.test(itemId)) return itemId;
  return 'datacenter';
}

export function resolveProxmoxSub(itemId?: string, sub?: string): string {
  const type = proxmoxEntityType(itemId);
  const valid =
    type === 'datacenter'
      ? ['summary', 'guests', 'storage', 'disks', 'sensors']
      : type === 'node'
        ? ['summary', 'disks', 'storage', 'network']
        : ['summary'];
  return sub && valid.includes(sub) ? sub : 'summary';
}

export function subLabel(section: Section, sub: string): string {
  const subs = SUBS[section];
  return subs?.find((s) => s.id === sub)?.label ?? sub;
}

import { getState, setState } from './store';

const STORAGE_KEY = 'route';
const KNOWN_SECTIONS = new Set<Section>(Object.keys(SECTION_LABEL) as Section[]);

function normalizeRoute(route: PersistedRoute): Route {
  let rawSection = route.section === 'storage' ? 'nas' : route.section;
  // Legacy top-level sections (events/alerts/health/siem) now live as
  // Observability tabs — redirect deep links and persisted routes.
  let legacySub: string | undefined;
  if (typeof rawSection === 'string' && rawSection in OBSERVABILITY_LEGACY) {
    legacySub = OBSERVABILITY_LEGACY[rawSection];
    rawSection = 'observability';
  }
  const section: Section =
    rawSection && KNOWN_SECTIONS.has(rawSection as Section) ? (rawSection as Section) : 'overview';
  const sub =
    legacySub ??
    (section === 'proxmox' && (route.sub === 'drives' || route.sub === 'compute')
      ? 'summary'
      : route.sub);
  const itemId =
    section === 'inventory'
      ? route.itemId
      : section === 'proxmox'
        ? normalizeProxmoxItemId(route.itemId)
        : undefined;
  return {
    section,
    sub: section === 'proxmox' ? resolveProxmoxSub(itemId, sub) : resolveSub(section, sub),
    itemId,
  };
}

export function loadRoute(): Route {
  const parsed = getState<PersistedRoute | null>(STORAGE_KEY, null);
  if (!parsed?.section) return { section: 'overview' };
  return normalizeRoute(parsed);
}

export function saveRoute(r: Route): void {
  setState<Route>(STORAGE_KEY, r);
}
