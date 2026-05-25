/* =========================================================
   Persistent app state — server-backed with localStorage fallback.

   Every persisted setting in the dashboard (inventory, thresholds,
   bookmarks order, sidebar, route, tempUnit, tweaks) goes through
   this module instead of touching `window.localStorage` directly.

   On boot, `hydrateStore()` pulls the full state map from
   `GET /api/state`. Reads after that are synchronous against an
   in-memory Map. Writes update the map immediately and debounce-flush
   a `PUT /api/state/:key` so per-keystroke edits don't hammer the
   network.

   If the initial hydrate fails (e.g. server is down), we fall back
   to reading legacy `homelab-dashboard.*` keys out of localStorage,
   so the dashboard still renders.

   First time the server returns an empty state, we copy any legacy
   localStorage entries up to the server in a single bulk import,
   then clean up the localStorage keys.
   ========================================================= */

type Listener = () => void;

const DEBOUNCE_MS = 250;
const HYDRATE_TIMEOUT_MS = 4000;

const LEGACY_KEY_MAP: Record<string, string> = {
  inventory:         'homelab-dashboard.inventory',
  route:             'homelab-dashboard.route',
  thresholds:        'homelab-dashboard.thresholds',
  tempUnit:          'homelab-dashboard.tempUnit',
  tweaks:            'homelab-dashboard.tweaks',
  sidebarCollapsed:  'homelab-dashboard.sidebar-collapsed',
  sidebarExpanded:   'homelab-dashboard.sidebar-expanded',
  bookmarksOrder:    'homelab-dashboard.bookmarks.order',
};

const state = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let hydrated = false;
let degraded = false;
let channel: BroadcastChannel | null = null;

function notify(key: string): void {
  const set = listeners.get(key);
  if (set) for (const fn of set) fn();
}

function readLegacy(legacyKey: string): unknown {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(legacyKey);
    if (raw == null) return undefined;
    // tempUnit and sidebarCollapsed are stored as raw strings, not JSON.
    if (legacyKey === 'homelab-dashboard.tempUnit') return raw;
    if (legacyKey === 'homelab-dashboard.sidebar-collapsed') return raw === '1';
    try { return JSON.parse(raw); } catch { return raw; }
  } catch {
    return undefined;
  }
}

function fetchWithTimeout(url: string, init?: RequestInit, ms = HYDRATE_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function importLegacyToServer(): Promise<Record<string, unknown>> {
  const bundle: Record<string, unknown> = {};
  for (const [storeKey, legacyKey] of Object.entries(LEGACY_KEY_MAP)) {
    const value = readLegacy(legacyKey);
    if (value !== undefined) bundle[storeKey] = value;
  }
  if (Object.keys(bundle).length === 0) return {};
  try {
    const res = await fetchWithTimeout('/api/state/_import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    if (!res.ok) return {};
    // Imported successfully — wipe legacy keys so we never re-import.
    try {
      for (const legacyKey of Object.values(LEGACY_KEY_MAP)) {
        window.localStorage.removeItem(legacyKey);
      }
    } catch { /* ignore */ }
    return bundle;
  } catch {
    return {};
  }
}

export async function hydrateStore(): Promise<void> {
  if (hydrated) return;
  try {
    const res = await fetchWithTimeout('/api/state');
    if (!res.ok) throw new Error(`state hydrate ${res.status}`);
    const body = await res.json() as { values?: Record<string, unknown> };
    const values = body.values ?? {};

    // First-time migration: if the server has no rows, bulk-import legacy
    // localStorage keys so existing users don't lose their data.
    if (Object.keys(values).length === 0) {
      const imported = await importLegacyToServer();
      for (const [k, v] of Object.entries(imported)) state.set(k, v);
    } else {
      for (const [k, v] of Object.entries(values)) state.set(k, v);
    }

    hydrated = true;
    degraded = false;

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel('homelab-state');
      channel.onmessage = (ev) => {
        const msg = ev.data as { key?: string; value?: unknown; deleted?: boolean };
        if (!msg?.key) return;
        if (msg.deleted) {
          state.delete(msg.key);
        } else {
          state.set(msg.key, msg.value);
        }
        notify(msg.key);
      };
    }
  } catch {
    // Server unreachable — populate from legacy localStorage so the UI still works.
    for (const [storeKey, legacyKey] of Object.entries(LEGACY_KEY_MAP)) {
      const value = readLegacy(legacyKey);
      if (value !== undefined) state.set(storeKey, value);
    }
    hydrated = true;
    degraded = true;
  }

  // Notify every subscriber so modules that snapshotted a value at import
  // time (before hydrate finished) pick up the real value. Without this,
  // e.g. thresholds.ts holds DEFAULT_THRESHOLDS forever and silently
  // overwrites the user's saved customization on the next edit.
  for (const key of state.keys()) notify(key);
}

export function isHydrated(): boolean {
  return hydrated;
}

export function isDegraded(): boolean {
  return degraded;
}

export function getState<T>(key: string, fallback: T): T {
  if (!state.has(key)) return fallback;
  return state.get(key) as T;
}

export function setState<T>(key: string, value: T): void {
  state.set(key, value);
  notify(key);
  if (channel) {
    try { channel.postMessage({ key, value }); } catch { /* ignore */ }
  }
  scheduleFlush(key);
}

export function deleteState(key: string): void {
  state.delete(key);
  notify(key);
  if (channel) {
    try { channel.postMessage({ key, deleted: true }); } catch { /* ignore */ }
  }
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  pendingTimers.delete(key);
  if (degraded) {
    try { window.localStorage.removeItem(LEGACY_KEY_MAP[key] ?? key); } catch { /* ignore */ }
    return;
  }
  fetch(`/api/state/${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => { /* ignore */ });
}

export function subscribe(key: string, fn: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(key);
  };
}

function scheduleFlush(key: string): void {
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pendingTimers.delete(key);
    void flush(key);
  }, DEBOUNCE_MS);
  pendingTimers.set(key, t);
}

async function flush(key: string): Promise<void> {
  const value = state.get(key);
  if (degraded) {
    // Server unreachable — persist to legacy localStorage so edits survive a reload.
    try {
      const legacyKey = LEGACY_KEY_MAP[key];
      if (!legacyKey) return;
      if (legacyKey === 'homelab-dashboard.tempUnit' && typeof value === 'string') {
        window.localStorage.setItem(legacyKey, value);
      } else if (legacyKey === 'homelab-dashboard.sidebar-collapsed') {
        window.localStorage.setItem(legacyKey, value ? '1' : '0');
      } else {
        window.localStorage.setItem(legacyKey, JSON.stringify(value));
      }
    } catch { /* ignore */ }
    return;
  }
  try {
    await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  } catch {
    /* swallow — next write will retry */
  }
}
