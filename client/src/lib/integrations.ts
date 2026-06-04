import type { IntegrationKey } from './telemetry';

export interface IntegrationDef {
  key: IntegrationKey;
  // What field on /api/health to consult for server-side state. Matches the
  // shape `{ enabled, configured }` returned by the server health route.
  healthField: string;
  label: string;
  description: string;
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: 'unifi',
    healthField: 'unifi',
    label: 'Network',
    description: 'Gateway, switches, APs, clients, WAN throughput.',
  },
  {
    key: 'proxmox',
    healthField: 'proxmox',
    label: 'Data Center',
    description: 'VM/LXC inventory, CPU/RAM, storage pools.',
  },
  {
    key: 'docker',
    healthField: 'portainer',
    label: 'Docker',
    description: 'Containers + hosts via Portainer.',
  },
  {
    key: 'unas',
    healthField: 'unas',
    label: 'NAS',
    description: 'Pools, disks, fan profile.',
  },
  {
    key: 'gpu',
    healthField: 'gpu',
    label: 'GPU',
    description: 'nvidia-smi telemetry (local or over SSH).',
  },
  {
    key: 'sensors',
    healthField: 'sensors',
    label: 'Host Sensors',
    description: 'lm-sensors: CPU/drive temps, fan RPMs.',
  },
];

export interface HealthInfo {
  enabled: boolean;
  configured: boolean;
}

export type HealthResponse = Record<string, HealthInfo | unknown> & { ok?: boolean };
