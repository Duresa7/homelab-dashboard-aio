import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

async function loadStore() {
  vi.resetModules();
  return import('./store');
}

describe('DashboardState persistence store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    FakeBroadcastChannel.instances = [];
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hydrates synchronously-readable state from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ values: { route: { section: 'overview' } } })),
    );

    const store = await loadStore();
    await store.hydrateStore();

    expect(store.isHydrated()).toBe(true);
    expect(store.isDegraded()).toBe(false);
    expect(store.getState('route', null)).toEqual({ section: 'overview' });
  });

  it('falls back to legacy localStorage when the server is unreachable', async () => {
    localStorage.setItem('homelab-dashboard.tempUnit', 'f');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const store = await loadStore();
    await store.hydrateStore();

    expect(store.isDegraded()).toBe(true);
    expect(store.getState('tempUnit', 'c')).toBe('f');

    store.setState('tempUnit', 'c');
    await vi.advanceTimersByTimeAsync(250);
    expect(localStorage.getItem('homelab-dashboard.tempUnit')).toBe('c');
  });

  it('notifies subscribers and debounces server writes', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/state' && !init) return jsonResponse({ values: {} });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await loadStore();
    await store.hydrateStore();

    const listener = vi.fn();
    const unsubscribe = store.subscribe('route', listener);
    store.setState('route', { section: 'docker' });
    store.setState('route', { section: 'network' });

    expect(listener).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/state/route', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'network' }),
    });

    unsubscribe();
    store.setState('route', { section: 'settings' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('deletes state through the server when not degraded', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/state' && !init) return jsonResponse({ values: { route: 'overview' } });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await loadStore();
    await store.hydrateStore();
    store.deleteState('route');

    expect(store.getState('route', null)).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/state/route', { method: 'DELETE' });
  });

  it('applies cross-tab broadcasts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ values: { route: { section: 'overview' } } })),
    );

    const store = await loadStore();
    await store.hydrateStore();

    const listener = vi.fn();
    store.subscribe('route', listener);
    FakeBroadcastChannel.instances[0].onmessage?.({
      data: { key: 'route', value: { section: 'inventory' } },
    });

    expect(store.getState('route', null)).toEqual({ section: 'inventory' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
