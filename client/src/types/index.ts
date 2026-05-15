export type Severity = 'ok' | 'warn' | 'bad' | 'info';
export type ChartKind = 'area' | 'sparkline' | 'bars';

export interface Core {
  id: number;
  pct: number;
  target: number;
}

export interface CPUData {
  model: string;
  cores: number;
  threads: number;
  usage: number;
  target: number;
  tempC: number;
  tempTarget: number;
  history: number[];
  tempHistory: number[];
  coreList: Core[];
}

export interface RAMData {
  totalGB: number;
  usedGB: number;
  target: number;
  cachedGB: number;
  history: number[];
}

export interface GPUData {
  model: string;
  usage: number;
  target: number;
  memUsedGB: number;
  memTotalGB: number;
  tempC: number;
  powerW: number;
  powerMaxW: number;
  fanPct: number;
  history: number[];
}

export interface Fan {
  name: string;
  rpm: number;
  target: number;
  max: number;
}

export interface StoragePool {
  name: string;
  type: string;
  totalTB: number;
  usedTB: number;
  status: 'online' | 'degraded' | 'offline';
  scrub: string;
}

export interface Disk {
  name: string;
  model: string;
  tempC: number;
  smart: 'ok' | 'warn' | 'bad';
  wear: number;
}

export interface StorageData {
  pools: StoragePool[];
  disks: Disk[];
}

export interface DockerHost {
  id: string;
  name: string;
  addr: string;
  os: string;
  engine: string;
  cpu: number;
  ram: number;
  status: 'online' | 'offline';
}

export interface Container {
  name: string;
  host: string;
  image: string;
  state: 'running' | 'stopped' | 'paused';
  cpu: number;
  memMB: number;
  uptime: string;
  stack: string;
}

export interface DockerData {
  running: number;
  stopped: number;
  total: number;
  updates: number;
  hosts: DockerHost[];
  containers: Container[];
}

export interface VM {
  id: number;
  name: string;
  type: 'VM' | 'LXC';
  state: 'running' | 'stopped' | 'paused';
  cpu: number;
  ram: number;
  disk: number;
}

export interface ProxmoxNode {
  name: string;
  cpu: number;
  ram: number;
  uptime: string;
  version: string;
}

export interface ProxmoxData {
  nodes: number;
  node: ProxmoxNode;
  vms: VM[];
  coresAllocated: number;
  coresTotal: number;
}

export interface UnifiGateway {
  model: string;
  cpu: number;
  ram: number;
  tempC: number;
  uptime: string;
  fwVersion: string;
}

export interface UnifiSwitch {
  name: string;
  model: string;
  state: string;
  poeUsedW: number;
  poeMaxW: number;
  ports: number;
  portsUp: number;
  portsActive: number;
}

export interface UnifiAP {
  name: string;
  model: string;
  state: string;
  clients: number;
  channel: string;
  frequency: number | null;
  airtime: number;
  txMbps: number;
}

export interface TopTalker {
  name: string;
  ip: string;
  type: string;
  access: string;
  connectedAt: string;
  rxMB: number;
  txMB: number;
}

export interface UnifiNetwork {
  id: string;
  name: string;
  vlanId: number | null;
  enabled: boolean;
  management: string;
  isDefault: boolean;
}

export interface UnifiSSID {
  id: string;
  name: string;
  enabled: boolean;
  security: string;
  broadcastingFrequencies: number[];
}

export interface ClientBreakdown {
  wireless: number;
  wired: number;
  vpn: number;
}

export interface UnifiFirewallSummary {
  zones: number;
  policies: number;
  policiesEnabled: number;
}

export interface UnifiVPNServer {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

export interface UnifiDNSRecord {
  id: string;
  type: string;
  domain: string;
  enabled: boolean;
}

export interface UnifiData {
  gateway: UnifiGateway;
  switches: UnifiSwitch[];
  aps: UnifiAP[];
  clients: number;
  clientBreakdown: ClientBreakdown;
  topTalkers: TopTalker[];
  wan: { down: number; up: number; downMax: number; upMax: number; public: string };
  networks: UnifiNetwork[];
  ssids: UnifiSSID[];
  firewall: UnifiFirewallSummary;
  vpnServers: UnifiVPNServer[];
  dnsRecords: UnifiDNSRecord[];
  appVersion: string | null;
}

export interface UnasShare {
  name: string;
  sizeTB: number;
}

export interface UnasData {
  model: string;
  tempC: number;
  fanRpm: number;
  uptime: string;
  pools: { name: string; type: string; usedTB: number; totalTB: number; status: string }[];
  shares: UnasShare[];
}

export interface NetworkData {
  downHistory: number[];
  upHistory: number[];
  latencyMs: number;
  latencyHistory: number[];
  speedtest: { down: number; up: number; ping: number; when: string };
  uptime30d: number;
  publicIp: string;
  dns: { name: string; ip: string; status: string }[];
}

export interface Backup {
  name: string;
  when: string;
  status: 'ok' | 'warn' | 'bad';
  sizeGB: number;
}

export interface UPSData {
  model: string;
  loadW: number;
  loadPct: number;
  batteryPct: number;
  runtimeMin: number;
  status: string;
}

export interface EventEntry {
  ts: string;
  kind: Severity;
  title: string;
  body: string;
}

export interface AlertEntry {
  kind: Severity;
  title: string;
  body: string;
  ago: string;
}

export interface DashboardState {
  now: number;
  cpu: CPUData;
  ram: RAMData;
  gpu: GPUData;
  fans: Fan[];
  storage: StorageData;
  docker: DockerData;
  proxmox: ProxmoxData;
  unifi: UnifiData;
  unas: UnasData;
  network: NetworkData;
  backups: Backup[];
  ups: UPSData;
  events: EventEntry[];
  alerts: AlertEntry[];
}
