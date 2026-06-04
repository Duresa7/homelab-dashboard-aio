import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRouteModules() {
  vi.resetModules();
  const store = await import('./store');
  const route = await import('./route');
  return { store, route };
}

describe('route persistence', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ values: {} }),
      })),
    );
  });

  it('falls back to overview for removed camera routes', async () => {
    const { store, route } = await loadRouteModules();

    store.setState('route', { section: 'cameras', sub: 'grid' });

    expect(route.loadRoute()).toEqual({ section: 'overview', sub: undefined, itemId: undefined });
  });
});
