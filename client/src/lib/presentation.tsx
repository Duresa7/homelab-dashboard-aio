import {
  Box,
  Container,
  Cpu,
  HardDrive,
  Network,
  ScrollText,
  Server,
  Thermometer,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { BrandIcon } from '@/components/icons/BrandIcon';
import {
  SETUP_CONFIG_CHANGED_EVENT,
  getCapabilities,
  getConfig,
  type Capability,
  type RedactedConfig,
} from './setup';
import type { Section } from './route';
import type { TileId } from '@/components/widgets';

export type CapabilityId =
  | 'datacenter'
  | 'network'
  | 'nas'
  | 'containers'
  | 'gpu'
  | 'sensors'
  | 'logs';

export interface CapabilityPresentation {
  id: CapabilityId;
  label: string;
  genericLabel: string;
  vendorLabel?: string;
  icon: string;
  enabled: boolean;
}

type PresentationMap = Record<CapabilityId, CapabilityPresentation>;

export const SECTION_CAPABILITY: Partial<Record<Section, CapabilityId>> = {
  proxmox: 'datacenter',
  network: 'network',
  docker: 'containers',
  nas: 'nas',
  siem: 'logs',
};

export const TILE_CAPABILITY: Partial<Record<TileId, CapabilityId>> = {
  gpu: 'gpu',
  storage: 'nas',
  network: 'network',
  unifi: 'network',
  docker: 'containers',
  proxmox: 'datacenter',
  unas: 'nas',
  fans: 'sensors',
  smart: 'nas',
  backups: 'nas',
  internet: 'network',
  topTalkers: 'network',
  tempHeat: 'sensors',
  events: 'logs',
};

const FALLBACK_CAPABILITIES: Capability[] = [
  {
    id: 'datacenter',
    label: 'Data Center',
    integrationKey: 'proxmox',
    providers: [
      {
        id: 'proxmox',
        label: 'Proxmox',
        icon: 'proxmox',
        adapter: 'proxmox',
        status: 'available',
        configSchema: [],
      },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    integrationKey: 'unifi',
    providers: [
      {
        id: 'unifi',
        label: 'UniFi',
        icon: 'unifi',
        adapter: 'unifi',
        status: 'available',
        configSchema: [],
      },
    ],
  },
  {
    id: 'nas',
    label: 'NAS',
    integrationKey: 'unas',
    providers: [
      {
        id: 'unas',
        label: 'UniFi NAS',
        icon: 'unifi-drive',
        adapter: 'unas',
        status: 'available',
        configSchema: [],
      },
    ],
  },
  {
    id: 'containers',
    label: 'Containers',
    integrationKey: 'docker',
    providers: [
      {
        id: 'portainer',
        label: 'Docker',
        icon: 'docker',
        adapter: 'docker',
        status: 'available',
        configSchema: [],
      },
    ],
  },
  {
    id: 'gpu',
    label: 'GPU',
    integrationKey: 'gpu',
    providers: [
      {
        id: 'nvidia',
        label: 'NVIDIA',
        icon: 'nvidia',
        adapter: 'gpu',
        status: 'available',
        configSchema: [],
      },
    ],
  },
  {
    id: 'sensors',
    label: 'Sensors',
    integrationKey: 'sensors',
    providers: [
      {
        id: 'lm-sensors',
        label: 'lm-sensors',
        icon: 'sensors',
        adapter: 'sensors',
        status: 'available',
        configSchema: [],
      },
    ],
  },
  {
    id: 'logs',
    label: 'Logs',
    integrationKey: 'siem',
    providers: [
      {
        id: 'syslog',
        label: 'Syslog / SIEM',
        icon: 'syslog',
        adapter: 'siem',
        status: 'available',
        configSchema: [],
      },
    ],
  },
];

const CURRENT_PROVIDER_BY_CAPABILITY: Record<CapabilityId, string> = {
  datacenter: 'proxmox',
  network: 'unifi',
  nas: 'unas',
  containers: 'portainer',
  gpu: 'nvidia',
  sensors: 'lm-sensors',
  logs: 'syslog',
};

const GENERIC_ICON: Record<CapabilityId, LucideIcon> = {
  datacenter: Server,
  network: Network,
  nas: HardDrive,
  containers: Container,
  gpu: Cpu,
  sensors: Thermometer,
  logs: ScrollText,
};

const PROVIDER_ICON: Record<string, { kind: 'dashboard'; name: string }> = {
  proxmox: { kind: 'dashboard', name: 'proxmox' },
  vmware: { kind: 'dashboard', name: 'vmware' },
  unifi: { kind: 'dashboard', name: 'unifi' },
  'unifi-drive': { kind: 'dashboard', name: 'unifi' },
  omada: { kind: 'dashboard', name: 'tp-link' },
  mikrotik: { kind: 'dashboard', name: 'mikrotik' },
  synology: { kind: 'dashboard', name: 'synology' },
  truenas: { kind: 'dashboard', name: 'truenas' },
  qnap: { kind: 'dashboard', name: 'qnap' },
  docker: { kind: 'dashboard', name: 'docker' },
  nvidia: { kind: 'dashboard', name: 'nvidia' },
  amd: { kind: 'dashboard', name: 'amd' },
};

function enabledConfig(config: RedactedConfig | null): Record<string, { vendor: string }> | null {
  if (!config) return null;
  const entries = config?.capabilities ?? {};
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, selection]) => selection.enabled)
      .map(([id, selection]) => [id, { vendor: selection.vendor }]),
  );
}

function isCapabilityId(id: string): id is CapabilityId {
  return id in CURRENT_PROVIDER_BY_CAPABILITY;
}

function labelFor(capability: Capability, providerId: string | undefined): string {
  if (!providerId || providerId === CURRENT_PROVIDER_BY_CAPABILITY[capability.id as CapabilityId]) {
    return capability.label;
  }
  return (
    capability.providers.find((provider) => provider.id === providerId)?.label ?? capability.label
  );
}

function buildPresentation(
  capabilities: Capability[],
  config: RedactedConfig | null,
  fallback?: PresentationMap,
): PresentationMap {
  const configured = enabledConfig(config);
  const enabledIds = configured ? new Set(Object.keys(configured)) : null;
  const out = {} as PresentationMap;

  for (const capability of capabilities) {
    if (!isCapabilityId(capability.id)) continue;
    const selectedVendor =
      configured?.[capability.id]?.vendor ??
      capability.providers.find((provider) => provider.status === 'available')?.id ??
      capability.providers[0]?.id;
    const provider = capability.providers.find((candidate) => candidate.id === selectedVendor);
    out[capability.id] = {
      id: capability.id,
      label: labelFor(capability, selectedVendor),
      genericLabel: capability.label,
      vendorLabel: provider?.label,
      icon: provider?.icon ?? capability.id,
      enabled: enabledIds ? enabledIds.has(capability.id) : true,
    };
  }

  return fallback ? { ...fallback, ...out } : out;
}

export const DEFAULT_PRESENTATION = buildPresentation(FALLBACK_CAPABILITIES, null);

const PresentationContext = createContext<PresentationMap>(DEFAULT_PRESENTATION);

export function PresentationProvider({ children }: { children: ReactNode }) {
  const [presentation, setPresentation] = useState<PresentationMap>(DEFAULT_PRESENTATION);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [capabilities, config] = await Promise.all([getCapabilities(), getConfig()]);
        if (!cancelled)
          setPresentation(buildPresentation(capabilities, config, DEFAULT_PRESENTATION));
      } catch {
        if (!cancelled) setPresentation(DEFAULT_PRESENTATION);
      }
    };
    void load();
    window.addEventListener(SETUP_CONFIG_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SETUP_CONFIG_CHANGED_EVENT, load);
    };
  }, []);

  return (
    <PresentationContext.Provider value={presentation}>{children}</PresentationContext.Provider>
  );
}

export function usePresentation(): PresentationMap {
  return useContext(PresentationContext);
}

export function useCapabilityPresentation(id: CapabilityId): CapabilityPresentation {
  return usePresentation()[id];
}

export function useSectionLabel(section: Section): string {
  const presentation = usePresentation();
  const capabilityId = SECTION_CAPABILITY[section];
  return capabilityId ? presentation[capabilityId].label : '';
}

export function useVisibleTiles(layout: TileId[]): TileId[] {
  const presentation = usePresentation();
  return useMemo(
    () =>
      layout.filter((id) => {
        const capabilityId = TILE_CAPABILITY[id];
        return !capabilityId || presentation[capabilityId].enabled;
      }),
    [layout, presentation],
  );
}

export function isSectionVisible(section: Section, presentation: PresentationMap): boolean {
  const capabilityId = SECTION_CAPABILITY[section];
  return !capabilityId || presentation[capabilityId].enabled;
}

const TILE_SUFFIX: Partial<Record<TileId, string>> = {
  storage: 'Pools',
  smart: 'Disk Health',
  backups: 'Backups',
  internet: 'Internet',
  topTalkers: 'Connected Clients',
  tempHeat: 'Temp Heatmap',
  fans: 'Fans',
};

export function tilePresentationLabel(
  id: TileId,
  fallback: string,
  presentation: PresentationMap,
): string {
  const capabilityId = TILE_CAPABILITY[id];
  if (!capabilityId) return fallback;
  const capability = presentation[capabilityId];
  const suffix = TILE_SUFFIX[id];
  return suffix ? `${capability.label} ${suffix}` : capability.label;
}

type IconProps = {
  capability: CapabilityId;
  icon?: string;
  label?: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
};

export function PresentationIcon({
  capability,
  icon,
  size = 18,
  className,
  strokeWidth,
}: IconProps) {
  const iconId = icon ?? capability;
  const source = PROVIDER_ICON[iconId];
  if (source?.kind === 'dashboard') {
    return <BrandIcon name={source.name} alt="" size={size} className={className} />;
  }
  const Fallback = GENERIC_ICON[capability] ?? Box;
  const props: ComponentProps<LucideIcon> = {
    size,
    className,
    strokeWidth: strokeWidth ?? 2,
  };
  return <Fallback {...props} />;
}

export function CapabilityTitle({
  capability,
  suffix,
}: {
  capability: CapabilityId;
  suffix?: string;
}) {
  const presentation = useCapabilityPresentation(capability);
  return (
    <>
      <PresentationIcon
        capability={presentation.id}
        icon={presentation.icon}
        label={presentation.vendorLabel ?? presentation.label}
      />{' '}
      {suffix ?? presentation.label}
    </>
  );
}
