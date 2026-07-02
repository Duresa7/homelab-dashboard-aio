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

  it('round-trips proxmox entity selection and normalizes invalid tabs', async () => {
    const { store, route } = await loadRouteModules();

    store.setState('route', { section: 'proxmox', itemId: 'node/pve1', sub: 'disks' });
    expect(route.loadRoute()).toEqual({ section: 'proxmox', itemId: 'node/pve1', sub: 'disks' });

    store.setState('route', { section: 'proxmox', itemId: 'guest/105', sub: 'storage' });
    expect(route.loadRoute()).toEqual({ section: 'proxmox', itemId: 'guest/105', sub: 'summary' });

    store.setState('route', { section: 'proxmox', itemId: 'bad/value/extra', sub: 'compute' });
    expect(route.loadRoute()).toEqual({
      section: 'proxmox',
      itemId: 'datacenter',
      sub: 'summary',
    });
  });

  it('keeps Kanban as the default Productivity subsection', async () => {
    const { store, route } = await loadRouteModules();

    store.setState('route', { section: 'productivity', sub: 'subscriptions' });
    expect(route.loadRoute()).toEqual({
      section: 'productivity',
      sub: 'subscriptions',
      itemId: undefined,
    });

    store.setState('route', { section: 'productivity', sub: 'missing' });
    expect(route.loadRoute()).toEqual({
      section: 'productivity',
      sub: 'kanban',
      itemId: undefined,
    });
  });
});
