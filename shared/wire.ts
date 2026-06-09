export type Severity = 'ok' | 'warn' | 'bad' | 'info';

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
  gpuClockMHz: number;
  memClockMHz: number;
  history: number[];
}

export type GpuWireData = Omit<GPUData, 'history'>;

export interface GpuSample {
  name: string;
  usage: number;
  memUsedMB: number;
  memTotalMB: number;
  tempC: number;
  powerW: number;
  powerMaxW: number;
  fanPct: number;
  gpuClockMHz: number;
  memClockMHz: number;
}

/** A GPU attributed to a specific Proxmox node (by canonical node name). */
export interface NodeGpu extends GpuWireData {
  node: string;
  /** GPU index within that node (0-based; a node may expose more than one). */
  index: number;
}

/** A node that was queried for per-node metrics but could not be read. */
export interface NodeUnavailable {
  node: string;
  reason: string;
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
  ageHours: number;
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
  node: string;
  ip: string | null;
}

export interface ProxmoxNode {
  name: string;
  ip: string | null;
  cpu: number;
  ram: number;
  ramUsedGB: number;
  ramTotalGB: number;
  ramAllocatedGB: number;
  cpuModel: string;
  cpuCores: number;
  cpuThreads: number;
  storageUsedTB: number;
  storageTotalTB: number;
  storagePct: number;
  uptime: string;
  version: string;
  status?: string;
  level?: string | null;
  maxcpu?: number;
  disk?: number;
  diskUsedTB?: number;
  diskTotalTB?: number;
  uptimeSec?: number;
}

export interface ProxmoxClusterNode {
  name: string;
  status: string;
  level: string | null;
  cpu: number;
  maxcpu: number;
  ram: number;
  ramUsedGB: number;
  ramTotalGB: number;
  disk: number;
  diskUsedTB: number;
  diskTotalTB: number;
  uptime: string;
  uptimeSec: number;
}

export interface PhysicalDisk {
  devpath: string;
  model: string;
  vendor: string;
  serial: string | null;
  sizeBytes: number;
  type: string;
  used: string | null;
  health: string | null;
  wearout: number | null;
  rpm: number;
}

export interface ProxmoxStorage {
  name: string;
  node: string;
  type: string;
  content: string;
  usedTB: number;
  totalTB: number;
  active: boolean;
  shared: boolean;
  zfsHealth: string | null;
}

export interface ProxmoxCluster {
  nodesOnline: number;
  nodesTotal: number;
  cpuUsed: number;
  cpuTotal: number;
  cpuPct: number;
  memUsedGB: number;
  memTotalGB: number;
  memPct: number;
  storageUsedTB: number;
  storageTotalTB: number;
  storagePct: number;
  guestsRunning: number;
  guestsTotal: number;
}

export interface ProxmoxData {
  nodes: ProxmoxClusterNode[];
  cluster: ProxmoxCluster;
  node: ProxmoxNode;
  vms: VM[];
  disks: PhysicalDisk[];
  storages: ProxmoxStorage[];
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

export interface UnifiFirewallZone {
  id: string;
  name: string;
  /** Number of networks attached to the zone. */
  networkCount: number;
}

export interface UnifiFirewallPolicy {
  id: string;
  name: string;
  enabled: boolean;
  action: string;
  /** Resolved zone names (falls back to the raw zone id). */
  sourceZone: string;
  destinationZone: string;
  index: number | null;
  predefined: boolean;
}

export interface UnifiFirewallSummary {
  zones: number;
  policies: number;
  policiesEnabled: number;
  zoneList: UnifiFirewallZone[];
  policyList: UnifiFirewallPolicy[];
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

export interface UnasScrub {
  status: string;
  scheduleEnabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

export interface UnasPool {
  name: string;
  type: string;
  usedTB: number;
  totalTB: number;
  status: string;
  scrub: UnasScrub | null;
  incompatibilities: string[];
}

export interface UnasSmartTest {
  type: string;
  status: string;
  result: string;
  finishedAt: string | null;
}

export interface UnasDisk {
  slot: string;
  model: string;
  tempC: number;
  sizeGB: number;
  smart: 'ok' | 'warn' | 'bad';
  powerOnHours: number;
  rpm: number;
  badSectors: number;
  uncorrectableSectors: number;
  lastSmartTest: UnasSmartTest | null;
}

export interface UnasData {
  name: string;
  model: string;
  tempC: number;
  fanProfile: string;
  pools: UnasPool[];
  disks: UnasDisk[];
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

export type NetworkWireData = Omit<NetworkData, 'downHistory' | 'upHistory' | 'latencyHistory'>;

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

export interface SensorTemp {
  name: string;
  tempC: number;
  type?: string;
}

export interface SensorFan {
  chip: string;
  name: string;
  rpm: number;
}

export interface SensorOther {
  chip: string;
  name: string;
  tempC: number;
}

export interface SensorsData {
  cpuTempC: number | null;
  systemTempC: number | null;
  systemTempLabel: string | null;
  cores: SensorTemp[];
  disks: SensorTemp[];
  memory: SensorTemp[];
  network: SensorTemp[];
  fans: SensorFan[];
  other: SensorOther[];
}

/** Sensor readings attributed to a specific Proxmox node. */
export interface NodeSensors extends SensorsData {
  node: string;
}

// SIEM - syslog events received from UniFi gear over UDP/514.
// Severity uses standard syslog codes (0=emerg .. 7=debug). The dashboard
// collapses 0-3 to 'bad', 4 to 'warn', 5-7 to 'info' for the chip UI.
export type SyslogSeverity = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type SyslogFormat = 'rfc3164' | 'cef';
export type SyslogDeviceKind = 'gateway' | 'ap' | 'switch' | 'controller' | 'unknown';
export type SyslogCategory =
  | 'firewall'
  | 'client'
  | 'ids'
  | 'vpn'
  | 'admin'
  | 'update'
  | 'system'
  | 'monitoring'
  | 'security'
  | 'threat';

export interface SyslogEvent {
  id: number;
  receivedAt: number;
  logTime: number | null;
  sourceIp: string;
  hostname: string | null;
  facility: number | null;
  severity: SyslogSeverity;
  tag: string | null;
  message: string;
  raw: string;
  format: SyslogFormat;
  deviceKind: SyslogDeviceKind;
  category: SyslogCategory;
  extra: Record<string, string> | null;
}

export interface SiemStatus {
  enabled: boolean;
  listening: boolean;
  host: string;
  port: number;
  serverAddress: string;
  eventsTotal: number;
  eventsLastHour: number;
  bytesReceived: number;
  packetsReceived: number;
  parseErrors: number;
  lastEventAt: number | null;
  clientCount: number;
  bindError: string | null;
  retentionDays?: number;
}

export interface SiemStats {
  window: string;
  sinceMs: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  byDeviceKind: Record<string, number>;
  bySource: { ip: string; count: number }[];
}

export interface DashboardState {
  now: number;
  cpu: CPUData;
  ram: RAMData;
  gpu: GPUData;
  /** Every GPU across the cluster, node-attributed (empty if none/disabled). */
  gpus: NodeGpu[];
  /** Nodes that GPU collection could not reach. */
  gpuUnavailable: NodeUnavailable[];
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
  sensors: SensorsData;
  /** Per-node sensor readings (empty until the node-aware backend responds). */
  sensorNodes: NodeSensors[];
  /** Nodes that sensor collection could not reach. */
  sensorsUnavailable: NodeUnavailable[];
}

export interface UnifiApiResponse {
  unifi: UnifiData;
  network: NetworkWireData;
}

export interface ProxmoxApiResponse {
  proxmox: ProxmoxData;
}

export interface DockerApiResponse {
  docker: DockerData;
}

export interface GpuApiResponse {
  /** Legacy "primary" GPU — kept for the single GPU tile until it migrates. */
  gpu: GpuWireData;
  /** Every GPU across the cluster, each tagged with its node + local index. */
  gpus: NodeGpu[];
  /** Nodes configured for GPU collection that could not be read. */
  unavailable?: NodeUnavailable[];
}

export interface UnasApiResponse {
  unas: UnasData;
}

export interface SensorsApiResponse {
  /** Legacy single-host sensors — kept until the UI is fully node-aware. */
  sensors: SensorsData;
  /** Per-node sensor readings (one entry per successfully-read node). */
  nodes?: NodeSensors[];
  /** Nodes configured for sensor collection that could not be read. */
  unavailable?: NodeUnavailable[];
}
