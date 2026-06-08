import { describe, expectTypeOf, it } from 'vitest';

import type {
  DashboardState,
  DockerApiResponse,
  GpuApiResponse,
  NetworkData,
  ProxmoxApiResponse,
  SensorsApiResponse,
  UnasApiResponse,
  UnifiApiResponse,
} from '../../shared/wire.ts';

describe('shared wire contract', () => {
  it('keeps endpoint payloads tied to the dashboard state contract', () => {
    expectTypeOf<ProxmoxApiResponse['proxmox']>().toEqualTypeOf<DashboardState['proxmox']>();
    expectTypeOf<DockerApiResponse['docker']>().toEqualTypeOf<DashboardState['docker']>();
    expectTypeOf<UnasApiResponse['unas']>().toEqualTypeOf<DashboardState['unas']>();
    expectTypeOf<SensorsApiResponse['sensors']>().toEqualTypeOf<DashboardState['sensors']>();
    expectTypeOf<UnifiApiResponse['unifi']>().toEqualTypeOf<DashboardState['unifi']>();

    expectTypeOf<UnifiApiResponse['network']>().toMatchTypeOf<
      Omit<NetworkData, 'downHistory' | 'upHistory' | 'latencyHistory'>
    >();
    expectTypeOf<GpuApiResponse['gpu']>().toMatchTypeOf<Omit<DashboardState['gpu'], 'history'>>();
  });
});
