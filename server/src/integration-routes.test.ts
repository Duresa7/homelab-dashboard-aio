import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { loadServerApp, withJsonUpstream } from './test/serverApp.js';

async function usingApp(
  env: Record<string, string>,
  fn: (api: ReturnType<typeof request>) => Promise<unknown>,
) {
  const ctx = await loadServerApp(env);
  try {
    return await fn(request(ctx.app));
  } finally {
    await ctx.cleanup();
  }
}

describe('Integration route contracts', () => {
  it('returns a stable disabled payload for every Integration when the kill-switch is on', async () => {
    await usingApp({ DISABLE_ALL: 'true' }, async (api) => {
      for (const path of [
        '/api/unifi',
        '/api/docker',
        '/api/proxmox',
        '/api/unas',
        '/api/gpu',
        '/api/sensors',
      ]) {
        const res = await api.get(path).expect(200);
        expect(res.body).toEqual({ disabled: true });
      }
    });
  });

  it('hides diagnostic endpoints unless explicitly enabled', async () => {
    await usingApp({}, async (api) => {
      for (const path of [
        '/api/debug',
        '/api/docker/debug',
        '/api/proxmox/debug',
        '/api/unas/debug',
        '/api/gpu/debug',
        '/api/sensors/debug',
        '/api/state/debug',
      ]) {
        await api.get(path).expect(404, { error: 'Not found' });
      }
    });
  });

  it('returns 503 not-configured responses without calling upstreams', async () => {
    await usingApp(
      {
        UNIFI_ENABLED: 'true',
        UNIFI_BASE_URL: 'http://127.0.0.1:9',
        PORTAINER_ENABLED: 'true',
        PROXMOX_ENABLED: 'true',
        UNAS_ENABLED: 'true',
        GPU_ENABLED: 'true',
        GPU_MODE: 'ssh',
        SENSORS_ENABLED: 'true',
        SENSORS_MODE: 'ssh',
      },
      async (api) => {
        const expectations: [string, RegExp][] = [
          ['/api/unifi', /UNIFI_API_KEY/i],
          ['/api/docker', /Portainer not configured/i],
          ['/api/proxmox', /Proxmox not configured/i],
          ['/api/unas', /UNAS not configured/i],
          ['/api/gpu', /GPU_SSH_HOST/i],
          ['/api/sensors', /no host configured/i],
        ];

        for (const [path, message] of expectations) {
          const res = await api.get(path).expect(503);
          expect(res.body.error).toMatch(message);
        }
      },
    );
  });

  it('normalizes a healthy UniFi upstream response', async () => {
    await withJsonUpstream(
      {
        '/proxy/network/integration/v1/sites': { data: [{ id: 'site-1', name: 'default' }] },
        '/proxy/network/integration/v1/sites/site-1/devices': {
          data: [
            {
              id: 'gw',
              name: 'Gateway',
              model: 'UCG-Fiber',
              firmwareVersion: '9.0.1',
              features: ['gateway'],
              ipAddress: '198.51.100.10',
            },
            { id: 'sw', name: 'Core Switch', model: 'USW-Pro', features: ['switching'] },
            { id: 'ap', name: 'Access Point', model: 'U7-Pro', features: ['accessPoint'] },
          ],
        },
        '/proxy/network/integration/v1/sites/site-1/clients': {
          data: [
            {
              name: 'Example Workstation',
              type: 'WIRED',
              uplinkDeviceId: 'sw',
              ipAddress: '198.51.100.50',
              connectedAt: '2026-06-01T12:00:00Z',
            },
            {
              name: 'Tablet',
              type: 'WIRELESS',
              uplinkDeviceId: 'ap',
              ipAddress: '198.51.100.51',
              connectedAt: '2026-06-01T12:01:00Z',
            },
          ],
        },
        '/proxy/network/integration/v1/sites/site-1/networks': {
          data: [{ id: 'lan', name: 'LAN', vlanId: 1, enabled: true, default: true }],
        },
        '/proxy/network/integration/v1/sites/site-1/wifi/broadcasts': {
          data: [{ id: 'ssid', name: 'Home', enabled: true, broadcastingFrequenciesGhz: [5] }],
        },
        '/proxy/network/integration/v1/sites/site-1/wans': { data: [] },
        '/proxy/network/integration/v1/sites/site-1/firewall/zones': { data: [{}] },
        '/proxy/network/integration/v1/sites/site-1/firewall/policies': {
          data: [{ enabled: true }, { enabled: false }],
        },
        '/proxy/network/integration/v1/sites/site-1/vpn/servers': {
          data: [{ id: 'vpn', name: 'WireGuard', type: 'wireguard', enabled: true }],
        },
        '/proxy/network/integration/v1/sites/site-1/dns/policies': {
          data: [{ id: 'dns', type: 'A', domain: 'dash.example.test', enabled: true }],
        },
        '/proxy/network/integration/v1/info': { applicationVersion: '9.3.0' },
        '/proxy/network/integration/v1/sites/site-1/devices/gw/statistics/latest': {
          cpuUtilizationPct: 12,
          memoryUtilizationPct: 34,
          temperature: 42,
          uptimeSec: 86400,
          uplink: { rxRateBps: 150_000_000, txRateBps: 50_000_000 },
          wanIp: '198.51.100.20',
        },
        '/proxy/network/integration/v1/sites/site-1/devices/gw': {
          interfaces: { ports: [] },
          state: 'ONLINE',
        },
        '/proxy/network/integration/v1/sites/site-1/devices/sw/statistics/latest': {
          poePortPower: 15,
          poeBudget: 120,
        },
        '/proxy/network/integration/v1/sites/site-1/devices/sw': {
          interfaces: { ports: [{ state: 'UP' }, { state: 'DOWN' }] },
          state: 'ONLINE',
        },
        '/proxy/network/integration/v1/sites/site-1/devices/ap/statistics/latest': {},
        '/proxy/network/integration/v1/sites/site-1/devices/ap': {
          interfaces: { radios: [{ channel: 44, frequencyGHz: 5 }] },
          state: 'ONLINE',
        },
      },
      async (baseUrl) => {
        await usingApp(
          { UNIFI_ENABLED: 'true', UNIFI_BASE_URL: baseUrl, UNIFI_API_KEY: 'key' },
          async (api) => {
            const res = await api.get('/api/unifi').expect(200);
            expect(res.body.unifi.gateway.model).toBe('UCG-Fiber');
            expect(res.body.unifi.clients).toBe(2);
            expect(res.body.unifi.clientBreakdown).toEqual({ wired: 1, wireless: 1, vpn: 0 });
            expect(res.body.unifi.switches[0]).toMatchObject({
              name: 'Core Switch',
              ports: 2,
              portsUp: 1,
            });
            expect(res.body.network.publicIp).toBe('198.51.100.20');
          },
        );
      },
    );
  });

  it('normalizes a healthy Portainer/Docker upstream response', async () => {
    await withJsonUpstream(
      {
        '/api/endpoints': [{ Id: 1, Name: 'container-host', URL: 'tcp://198.51.100.10:2375' }],
        '/api/endpoints/1/docker/containers/json': [
          {
            Id: 'abc123',
            Names: ['/dashboard'],
            Image: 'ghcr.io/example/dashboard:latest',
            State: 'running',
            Created: Math.floor(Date.now() / 1000) - 3600,
            Labels: { 'com.docker.compose.project': 'homelab' },
          },
        ],
        '/api/endpoints/1/docker/info': {
          MemTotal: 8 * 1024 ** 3,
          OperatingSystem: 'Debian GNU/Linux',
          ServerVersion: '27.0.0',
        },
        '/api/endpoints/1/docker/version': { Version: '27.0.1' },
      },
      async (baseUrl) => {
        await usingApp(
          {
            PORTAINER_ENABLED: 'true',
            PORTAINER_BASE_URL: baseUrl,
            PORTAINER_API_KEY: 'key',
            PORTAINER_STATS_ENABLED: 'false',
          },
          async (api) => {
            const res = await api.get('/api/docker').expect(200);
            expect(res.body.docker).toMatchObject({ running: 1, stopped: 0, total: 1 });
            expect(res.body.docker.hosts[0]).toMatchObject({
              id: '1',
              name: 'container-host',
              status: 'online',
            });
            expect(res.body.docker.containers[0]).toMatchObject({
              name: 'dashboard',
              stack: 'homelab',
              state: 'running',
            });
          },
        );
      },
    );
  });

  it('normalizes a healthy Proxmox upstream response', async () => {
    await withJsonUpstream(
      {
        '/api2/json/nodes': {
          data: [
            {
              node: 'node-a',
              status: 'online',
              maxcpu: 16,
              maxmem: 64 * 1024 ** 3,
              cpu: 0.25,
              mem: 16 * 1024 ** 3,
              uptime: 7200,
            },
          ],
        },
        '/api2/json/nodes/node-a/status': {
          data: {
            cpu: 0.5,
            uptime: 3600,
            pveversion: 'pve-manager/9.1.6/abc',
            memory: { used: 32 * 1024 ** 3, total: 64 * 1024 ** 3 },
            cpuinfo: { model: 'AMD Ryzen 9 9950X3D 16-Core Processor', cores: 16, cpus: 32 },
          },
        },
        '/api2/json/cluster/resources': {
          data: [
            {
              vmid: 105,
              name: 'ai-lab',
              type: 'lxc',
              status: 'running',
              node: 'node-a',
              maxcpu: 4,
              cpu: 0.1,
              mem: 2 * 1024 ** 3,
              maxmem: 4 * 1024 ** 3,
              maxdisk: 64 * 1024 ** 3,
            },
          ],
        },
        '/api2/json/nodes/node-a/storage': {
          data: [
            {
              storage: 'local-zfs',
              type: 'zfspool',
              content: 'images',
              enabled: true,
              active: true,
              used: 2 * 1024 ** 4,
              total: 8 * 1024 ** 4,
              pool: 'rpool',
            },
          ],
        },
        '/api2/json/nodes/node-a/network': {
          data: [{ iface: 'vmbr0', type: 'bridge', active: true, address: '198.51.100.10' }],
        },
        '/api2/json/nodes/node-a/lxc/105/interfaces': { data: [] },
        '/api2/json/nodes/node-a/lxc/105/config': { data: {} },
        '/api2/json/nodes/node-a/disks/list': {
          data: [
            {
              devpath: '/dev/nvme0n1',
              model: 'Samsung 990 PRO',
              vendor: 'Samsung',
              serial: 'S123',
              size: 2 * 1024 ** 4,
              type: 'ssd',
              health: 'PASSED',
              wearout: 3,
            },
          ],
        },
        '/api2/json/nodes/node-a/disks/zfs': { data: [{ name: 'rpool', health: 'ONLINE' }] },
      },
      async (baseUrl) => {
        await usingApp(
          {
            PROXMOX_ENABLED: 'true',
            PROXMOX_BASE_URL: baseUrl,
            PROXMOX_TOKEN_ID: 'root@pam!dash',
            PROXMOX_TOKEN_SECRET: 'secret',
          },
          async (api) => {
            const res = await api.get('/api/proxmox').expect(200);
            expect(res.body.proxmox.node).toMatchObject({
              name: 'node-a',
              ip: '198.51.100.10',
              cpu: 50,
              version: '9.1.6',
            });
            expect(res.body.proxmox.vms[0]).toMatchObject({
              id: 105,
              name: 'ai-lab',
              type: 'LXC',
              state: 'running',
            });
            expect(res.body.proxmox.storages[0].zfsHealth).toBe('ONLINE');
          },
        );
      },
    );
  });

  it('normalizes a healthy UNAS upstream response', async () => {
    await withJsonUpstream(
      {
        '/proxy/drive/api/v2/storage': {
          pools: [
            {
              id: 'pool1',
              number: 1,
              preferLevel: 'raid5',
              usage: 2 * 1024 ** 4,
              capacity: 4 * 1024 ** 4,
              status: 'fullyOperational',
            },
          ],
          disks: [
            {
              poolId: 'pool1',
              slotId: 1,
              model: 'ST4000VN008',
              temperature: 34,
              size: 4 * 1024 ** 4,
              state: 'optimal',
              powerOnHours: 100,
              rpm: 5400,
            },
          ],
        },
        '/proxy/drive/api/v2/systems/fan-control': { currentProfile: 'balanced' },
        '/api/system': { name: 'Example NAS', hardware: { shortname: 'UNAS4' } },
      },
      async (baseUrl) => {
        await usingApp(
          { UNAS_ENABLED: 'true', UNAS_BASE_URL: baseUrl, UNAS_API_KEY: 'key' },
          async (api) => {
            const res = await api.get('/api/unas').expect(200);
            expect(res.body.unas).toMatchObject({
              name: 'Example NAS',
              model: 'UNAS 4',
              fanProfile: 'balanced',
            });
            expect(res.body.unas.pools[0]).toMatchObject({ type: 'RAID 5', status: 'online' });
          },
        );
      },
    );
  });

  it('surfaces upstream failures as 502 errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await withJsonUpstream(
        {
          '/api/endpoints': { statusCode: 500, body: { error: 'upstream down' } },
        },
        async (baseUrl) => {
          await usingApp(
            {
              PORTAINER_ENABLED: 'true',
              PORTAINER_BASE_URL: baseUrl,
              PORTAINER_API_KEY: 'key',
            },
            async (api) => {
              const res = await api.get('/api/docker').expect(502);
              expect(res.body.error).toMatch(/Portainer API 500/i);
            },
          );
        },
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  // Pins the failure contract for the other HTTP integrations so the #05
  // decompose (which extracts the safe-fetch / route-factory layer) cannot
  // silently change error mapping. Each integration's PRIMARY (non-safe)
  // upstream call is forced to 500; the route must answer 502 with an error
  // string. (Sub-resource calls use safe* wrappers and degrade — that
  // swallowing is addressed in #07, not here.)
  it('maps a failing primary upstream to 502 for every HTTP integration', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const cases: {
      route: string;
      failPath: string;
      env: (baseUrl: string) => Record<string, string>;
    }[] = [
      {
        route: '/api/unifi',
        failPath: '/proxy/network/integration/v1/sites',
        env: (baseUrl) => ({
          UNIFI_ENABLED: 'true',
          UNIFI_BASE_URL: baseUrl,
          UNIFI_API_KEY: 'key',
        }),
      },
      {
        route: '/api/proxmox',
        failPath: '/api2/json/nodes',
        env: (baseUrl) => ({
          PROXMOX_ENABLED: 'true',
          PROXMOX_BASE_URL: baseUrl,
          PROXMOX_TOKEN_ID: 'root@pam!dash',
          PROXMOX_TOKEN_SECRET: 'secret',
        }),
      },
      {
        route: '/api/unas',
        failPath: '/proxy/drive/api/v2/storage',
        env: (baseUrl) => ({ UNAS_ENABLED: 'true', UNAS_BASE_URL: baseUrl, UNAS_API_KEY: 'key' }),
      },
    ];

    try {
      for (const { route, failPath, env } of cases) {
        await withJsonUpstream(
          { [failPath]: { statusCode: 500, body: { error: 'upstream down' } } },
          async (baseUrl) => {
            await usingApp(env(baseUrl), async (api) => {
              const res = await api.get(route).expect(502);
              expect(typeof res.body.error).toBe('string');
              expect(res.body.error.length).toBeGreaterThan(0);
            });
          },
        );
      }
    } finally {
      errorSpy.mockRestore();
    }
  });
});
