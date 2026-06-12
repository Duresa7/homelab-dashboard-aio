import { dockerProvider } from './docker.js';
import { gpuProvider } from './gpu.js';
import { proxmoxProvider } from './proxmox.js';
import { unasProvider } from './unas.js';
import { unifiProvider } from './unifi.js';
import type { Provider, RuntimeProvider } from './provider.js';

export const baseIntegrationProviders = [
  unifiProvider,
  dockerProvider,
  proxmoxProvider,
  gpuProvider,
  unasProvider,
] as const satisfies readonly Provider<unknown>[];

export interface ProviderCatalog {
  providers: readonly RuntimeProvider<unknown>[];
  providerByCapabilityId: ReadonlyMap<string, RuntimeProvider<unknown>>;
  providerById: ReadonlyMap<string, RuntimeProvider<unknown>>;
}

export function createProviderCatalog(
  runtimeProviders: readonly RuntimeProvider<unknown>[] = [],
): ProviderCatalog {
  const providers = [...baseIntegrationProviders, ...runtimeProviders];
  return {
    providers,
    providerByCapabilityId: new Map(providers.map((provider) => [provider.capabilityId, provider])),
    providerById: new Map(providers.map((provider) => [provider.id, provider])),
  };
}

export const integrationProviders = baseIntegrationProviders;
