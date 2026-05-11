import type { ChartKind, DashboardState } from '../../types';
import { CPUTile } from './CPUTile';
import { RAMTile } from './RAMTile';
import { GPUTile } from './GPUTile';
import { StorageTile } from './StorageTile';
import { NetworkTile } from './NetworkTile';
import { UnifiTile } from './UnifiTile';
import { DockerTile } from './DockerTile';
import { ProxmoxTile } from './ProxmoxTile';
import { UnasTile } from './UnasTile';
import { FansTile } from './FansTile';
import { SmartTile } from './SmartTile';
import { BackupsTile } from './BackupsTile';
import { UPSTile } from './UPSTile';
import { InternetTile } from './InternetTile';
import { TopTalkersTile } from './TopTalkersTile';
import { TempHeatTile } from './TempHeatTile';
import { NodesTile } from './NodesTile';
import { EventsTile } from './EventsTile';

export type TileId =
  | 'cpu' | 'ram' | 'gpu' | 'storage' | 'network' | 'unifi' | 'docker'
  | 'proxmox' | 'unas' | 'fans' | 'smart' | 'backups' | 'ups' | 'internet'
  | 'topTalkers' | 'tempHeat' | 'nodes' | 'events';

export interface TileDef {
  id: TileId;
  label: string;
  span: number;
}

export const ALL_TILES: TileDef[] = [
  { id: 'cpu', label: 'CPU', span: 6 },
  { id: 'ram', label: 'Memory', span: 3 },
  { id: 'gpu', label: 'GPU', span: 3 },
  { id: 'storage', label: 'Storage Pools', span: 4 },
  { id: 'network', label: 'Network', span: 4 },
  { id: 'unifi', label: 'Network (UniFi)', span: 4 },
  { id: 'docker', label: 'Docker', span: 8 },
  { id: 'proxmox', label: 'Proxmox', span: 4 },
  { id: 'unas', label: 'UniFi NAS', span: 4 },
  { id: 'fans', label: 'Fans', span: 4 },
  { id: 'smart', label: 'Disk Health', span: 4 },
  { id: 'backups', label: 'Backups', span: 4 },
  { id: 'ups', label: 'UPS', span: 4 },
  { id: 'internet', label: 'Internet', span: 4 },
  { id: 'topTalkers', label: 'Connected Clients', span: 4 },
  { id: 'tempHeat', label: 'Temp Heatmap', span: 6 },
  { id: 'nodes', label: 'Nodes', span: 6 },
  { id: 'events', label: 'Events', span: 6 },
];

export function tileData(id: TileId, d: DashboardState): unknown {
  switch (id) {
    case 'cpu': return d.cpu;
    case 'ram': return d.ram;
    case 'gpu': return d.gpu;
    case 'storage': return d.storage;
    case 'network': return d.network;
    case 'unifi': return d.unifi;
    case 'docker': return d.docker;
    case 'proxmox': return d.proxmox;
    case 'unas': return d.unas;
    case 'fans': return d.fans;
    case 'smart': return d.storage;
    case 'backups': return d.backups;
    case 'ups': return d.ups;
    case 'internet': return d.network;
    case 'topTalkers': return d.unifi.topTalkers;
    case 'tempHeat': return { cpu: d.cpu, gpu: d.gpu, disks: d.storage.disks };
    case 'nodes': return null;
    case 'events': return d.events;
  }
}

interface RenderProps {
  id: TileId;
  span: number;
  data: any;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  onExpand?: () => void;
  expandable?: boolean;
}

export function renderTile({ id, span, data, chartKind, onChartKind, onExpand, expandable }: RenderProps) {
  const common = { span, onExpand, expandable };
  switch (id) {
    case 'cpu':
      return <CPUTile {...common} data={data} chartKind={chartKind} onChartKind={onChartKind} />;
    case 'ram':
      return <RAMTile {...common} data={data} chartKind={chartKind} onChartKind={onChartKind} />;
    case 'gpu':
      return <GPUTile {...common} data={data} chartKind={chartKind} onChartKind={onChartKind} />;
    case 'storage':
      return <StorageTile {...common} data={data} />;
    case 'network':
      return <NetworkTile {...common} data={data} chartKind={chartKind} onChartKind={onChartKind} />;
    case 'unifi':
      return <UnifiTile {...common} data={data} />;
    case 'docker':
      return <DockerTile {...common} data={data} />;
    case 'proxmox':
      return <ProxmoxTile {...common} data={data} />;
    case 'unas':
      return <UnasTile {...common} data={data} />;
    case 'fans':
      return <FansTile {...common} data={data} />;
    case 'smart':
      return <SmartTile {...common} data={data} />;
    case 'backups':
      return <BackupsTile {...common} data={data} />;
    case 'ups':
      return <UPSTile {...common} data={data} />;
    case 'internet':
      return <InternetTile {...common} data={data} />;
    case 'topTalkers':
      return <TopTalkersTile {...common} data={data} />;
    case 'tempHeat':
      return <TempHeatTile {...common} cpu={data.cpu} gpu={data.gpu} disks={data.disks} />;
    case 'nodes':
      return <NodesTile {...common} />;
    case 'events':
      return <EventsTile {...common} data={data} />;
  }
}
