export type CapabilityId =
  | 'datacenter'
  | 'network'
  | 'nas'
  | 'containers'
  | 'gpu'
  | 'sensors'
  | 'logs';

export type ConfigFieldType = 'text' | 'url' | 'password' | 'number' | 'boolean' | 'select';

export interface ConfigField {
  name: string;
  label: string;
  type: ConfigFieldType;
  required: boolean;

  secret?: boolean;
  help?: string;
  default?: string | number | boolean;

  options?: { value: string; label: string }[];

  env?: string;
}

export interface VendorProvider {
  id: string;
  label: string;

  icon: string;

  adapter: string;
  status: 'available' | 'planned';
  configSchema: ConfigField[];
}

export interface Capability {
  id: CapabilityId;

  label: string;

  integrationKey: string;
  providers: VendorProvider[];
}

export const CAPABILITIES: Capability[] = [
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
        configSchema: [
          {
            name: 'baseUrl',
            label: 'Base URL',
            type: 'url',
            required: true,
            env: 'PROXMOX_BASE_URL',
          },
          {
            name: 'tokenId',
            label: 'API token ID',
            type: 'text',
            required: true,
            env: 'PROXMOX_TOKEN_ID',
          },
          {
            name: 'tokenSecret',
            label: 'API token secret',
            type: 'password',
            required: true,
            secret: true,
            env: 'PROXMOX_TOKEN_SECRET',
          },
          { name: 'node', label: 'Node name', type: 'text', required: true, env: 'PROXMOX_NODE' },
        ],
      },
      {
        id: 'vmware',
        label: 'VMware ESXi',
        icon: 'vmware',
        adapter: 'proxmox',
        status: 'planned',
        configSchema: [],
      },
      {
        id: 'xcpng',
        label: 'XCP-ng',
        icon: 'xcpng',
        adapter: 'proxmox',
        status: 'planned',
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
        configSchema: [
          {
            name: 'baseUrl',
            label: 'Base URL',
            type: 'url',
            required: true,
            env: 'UNIFI_BASE_URL',
          },
          {
            name: 'apiKey',
            label: 'API key',
            type: 'password',
            required: true,
            secret: true,
            env: 'UNIFI_API_KEY',
          },
          {
            name: 'site',
            label: 'Site',
            type: 'text',
            required: false,
            default: 'default',
            env: 'UNIFI_SITE',
          },
        ],
      },
      {
        id: 'omada',
        label: 'TP-Link Omada',
        icon: 'omada',
        adapter: 'unifi',
        status: 'planned',
        configSchema: [],
      },
      {
        id: 'mikrotik',
        label: 'MikroTik',
        icon: 'mikrotik',
        adapter: 'unifi',
        status: 'planned',
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
        configSchema: [
          { name: 'baseUrl', label: 'Base URL', type: 'url', required: true, env: 'UNAS_BASE_URL' },
          {
            name: 'apiKey',
            label: 'API key',
            type: 'password',
            required: true,
            secret: true,
            env: 'UNAS_API_KEY',
          },
        ],
      },
      {
        id: 'synology',
        label: 'Synology',
        icon: 'synology',
        adapter: 'unas',
        status: 'planned',
        configSchema: [],
      },
      {
        id: 'truenas',
        label: 'TrueNAS',
        icon: 'truenas',
        adapter: 'unas',
        status: 'planned',
        configSchema: [],
      },
      {
        id: 'qnap',
        label: 'QNAP',
        icon: 'qnap',
        adapter: 'unas',
        status: 'planned',
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
        label: 'Docker (Portainer)',
        icon: 'docker',
        adapter: 'docker',
        status: 'available',
        configSchema: [
          {
            name: 'baseUrl',
            label: 'Portainer URL',
            type: 'url',
            required: true,
            env: 'PORTAINER_BASE_URL',
          },
          {
            name: 'apiKey',
            label: 'API key',
            type: 'password',
            required: true,
            secret: true,
            env: 'PORTAINER_API_KEY',
          },
          {
            name: 'statsEnabled',
            label: 'Collect container stats',
            type: 'boolean',
            required: false,
            default: false,
            env: 'PORTAINER_STATS_ENABLED',
          },
        ],
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
        configSchema: [
          {
            name: 'mode',
            label: 'Source',
            type: 'select',
            required: true,
            default: 'local',
            options: [
              { value: 'local', label: 'Local (nvidia-smi)' },
              { value: 'ssh', label: 'Remote (SSH)' },
            ],
            env: 'GPU_MODE',
          },
          {
            name: 'sshHost',
            label: 'SSH host',
            type: 'text',
            required: false,
            help: 'Required when source is SSH',
            env: 'GPU_SSH_HOST',
          },
        ],
      },
      { id: 'amd', label: 'AMD', icon: 'amd', adapter: 'gpu', status: 'planned', configSchema: [] },
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
        configSchema: [
          {
            name: 'mode',
            label: 'Source',
            type: 'select',
            required: true,
            default: 'local',
            options: [
              { value: 'local', label: 'Local' },
              { value: 'ssh', label: 'Remote (SSH)' },
            ],
            env: 'SENSORS_MODE',
          },
          {
            name: 'sshHost',
            label: 'SSH host',
            type: 'text',
            required: false,
            help: 'Required when source is SSH',
            env: 'SENSORS_SSH_HOST',
          },
        ],
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
        configSchema: [
          {
            name: 'port',
            label: 'Syslog UDP port',
            type: 'number',
            required: false,
            default: 514,
            env: 'SIEM_PORT',
          },
          {
            name: 'host',
            label: 'Bind address',
            type: 'text',
            required: false,
            default: '0.0.0.0',
            env: 'SIEM_HOST',
          },
          {
            name: 'retentionDays',
            label: 'Retention (days)',
            type: 'number',
            required: false,
            default: 30,
            env: 'SIEM_RETENTION_DAYS',
          },
        ],
      },
    ],
  },
];

export function getCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

export function getProvider(capabilityId: string, providerId: string): VendorProvider | undefined {
  return getCapability(capabilityId)?.providers.find((p) => p.id === providerId);
}

export function availableProviders(): { capability: Capability; provider: VendorProvider }[] {
  const out: { capability: Capability; provider: VendorProvider }[] = [];
  for (const capability of CAPABILITIES) {
    for (const provider of capability.providers) {
      if (provider.status === 'available') out.push({ capability, provider });
    }
  }
  return out;
}
