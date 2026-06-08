import { dockerProvider } from './docker.js';
import { gpuProvider } from './gpu.js';
import { proxmoxProvider } from './proxmox.js';
import { unasProvider } from './unas.js';
import { unifiProvider } from './unifi.js';
import type { Provider } from './provider.js';

export const integrationProviders = [
  unifiProvider,
  dockerProvider,
  proxmoxProvider,
  gpuProvider,
  unasProvider,
] as const satisfies readonly Provider<unknown>[];

export const providerByCapabilityId = new Map<string, Provider<unknown>>(
  integrationProviders.map((provider) => [provider.capabilityId, provider]),
);

export const providerById = new Map<string, Provider<unknown>>(
  integrationProviders.map((provider) => [provider.id, provider]),
);
