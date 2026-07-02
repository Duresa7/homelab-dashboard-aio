import { useEffect, useState } from 'react';
import { getConnectivity } from './connectivity';
import { apiFetch, readApiError } from './http';
import { effectiveIntervalMs } from './refresh-rate';
import type {
  AmtApiResponse,
  AmtData,
  DashboardState,
  Disk,
  DockerApiResponse,
  GpuApiResponse,
  NetworkData,
  ProxmoxApiResponse,
  SensorsApiResponse,
  StoragePool,
  UnasApiResponse,
  UnifiApiResponse,
  UnifiData,
} from '../types';

const N_HISTORY = 60;
const UNIFI_POLL_MS = 2000;
const PROXMOX_POLL_MS = 5000;
const DOCKER_POLL_MS = 10000;
const GPU_POLL_MS = 5000;
const SENSORS_POLL_MS = 5000;
const UNAS_POLL_MS = 30000;
const AMT_POLL_MS = 15000;
const OFFLINE_BACKOFF_MS = 15000;

export type IntegrationKey = 'unifi' | 'proxmox' | 'docker' | 'gpu' | 'sensors' | 'unas' | 'amt';

type PollerPayloads = {
  unifi: UnifiApiResponse;
  proxmox: ProxmoxApiResponse;
  docker: DockerApiResponse;
  gpu: GpuApiResponse;
  sensors: SensorsApiResponse;
  unas: UnasApiResponse;
  amt: AmtApiResponse;
};

type ApiEnvelope<T extends object> = T | { disabled: true } | { error: string };

export type TelemetryStatus = 'idle' | 'ok' | 'stale' | 'error' | 'disabled';

export interface TelemetryIntegrationState {
  status: TelemetryStatus;
  lastOkAt: number | null;
  lastError: string | null;
  staleReason: string | null;
  updatedAt: number | null;
}

function zeros(): number[] {
  return Array(N_HISTORY).fill(0);
}

function emptyUnifi(): UnifiData {
  return {
    gateway: { model: '—', cpu: 0, ram: 0, tempC: 0, uptime: '—', fwVersion: '—' },
    switches: [],
    aps: [],
    clients: 0,
    clientBreakdown: { wireless: 0, wired: 0, vpn: 0 },
    topTalkers: [],
    wan: { down: 0, up: 0, downMax: 1, upMax: 1, public: '—' },
    networks: [],
    ssids: [],
    firewall: { zones: 0, policies: 0, policiesEnabled: 0, zoneList: [], policyList: [] },
    vpnServers: [],
    dnsRecords: [],
    appVersion: null,
  };
}

function emptyAmt(): AmtData {
  return { devices: [], total: 0, online: 0, offline: 0, unreachable: 0 };
}

function emptyNetwork(): NetworkData {
  return {
    downHistory: zeros(),
    upHistory: zeros(),
    latencyMs: 0,
    latencyHistory: zeros(),
    speedtest: { down: 0, up: 0, ping: 0, when: '—' },
    uptime30d: 0,
    publicIp: '—',
    dns: [],
  };
}

function buildInit(): DashboardState {
  return {
    now: Date.now(),
    cpu: {
      model: '—',
      cores: 0,
      threads: 0,
      usage: 0,
      target: 0,
      tempC: 0,
      tempTarget: 0,
      history: zeros(),
      tempHistory: zeros(),
      coreList: [],
    },
    ram: { totalGB: 0, usedGB: 0, target: 0, cachedGB: 0, history: zeros() },
    gpu: {
      model: '—',
      usage: 0,
      target: 0,
      memUsedGB: 0,
      memTotalGB: 0,
      tempC: 0,
      powerW: 0,
      powerMaxW: 0,
      fanPct: 0,
      gpuClockMHz: 0,
      memClockMHz: 0,
      history: zeros(),
    },
    gpus: [],
    gpuUnavailable: [],
    fans: [],
    storage: { pools: [], disks: [] },
    docker: { running: 0, stopped: 0, total: 0, updates: 0, hosts: [], containers: [] },
    proxmox: {
      nodes: [],
      cluster: {
        nodesOnline: 0,
        nodesTotal: 0,
        cpuUsed: 0,
        cpuTotal: 0,
        cpuPct: 0,
        memUsedGB: 0,
        memTotalGB: 0,
        memPct: 0,
        storageUsedTB: 0,
        storageTotalTB: 0,
        storagePct: 0,
        guestsRunning: 0,
        guestsTotal: 0,
      },
      node: {
        name: '—',
        ip: null,
        cpu: 0,
        ram: 0,
        ramUsedGB: 0,
        ramTotalGB: 0,
        ramAllocatedGB: 0,
        cpuModel: '—',
        cpuCores: 0,
        cpuThreads: 0,
        storageUsedTB: 0,
        storageTotalTB: 0,
        storagePct: 0,
        uptime: '—',
        version: '—',
      },
      vms: [],
      disks: [],
      storages: [],
      coresAllocated: 0,
      coresTotal: 0,
    },
    unifi: emptyUnifi(),
    unas: { name: '—', model: '—', tempC: 0, fanProfile: '—', pools: [], disks: [] },
    network: emptyNetwork(),
    backups: [],
    ups: { model: '—', loadW: 0, loadPct: 0, batteryPct: 0, runtimeMin: 0, status: '—' },
    events: [],
    alerts: [],
    sensors: {
      cpuTempC: null,
      systemTempC: null,
      systemTempLabel: null,
      cores: [],
      disks: [],
      memory: [],
      network: [],
      fans: [],
      other: [],
    },
    sensorNodes: [],
    sensorsUnavailable: [],
    amt: emptyAmt(),
  };
}

const state: DashboardState = buildInit();
const subs = new Set<() => void>();
const telemetrySubs = new Set<() => void>();

const initialTelemetryState: TelemetryIntegrationState = {
  status: 'idle',
  lastOkAt: null,
  lastError: null,
  staleReason: null,
  updatedAt: null,
};

const telemetryState: Record<IntegrationKey, TelemetryIntegrationState> = {
  unifi: { ...initialTelemetryState },
  proxmox: { ...initialTelemetryState },
  docker: { ...initialTelemetryState },
  gpu: { ...initialTelemetryState },
  sensors: { ...initialTelemetryState },
  unas: { ...initialTelemetryState },
  amt: { ...initialTelemetryState },
};

function notify(): void {
  subs.forEach((fn) => fn());
}

function notifyTelemetry(): void {
  telemetrySubs.forEach((fn) => fn());
}

function setTelemetryState(key: IntegrationKey, next: Partial<TelemetryIntegrationState>): void {
  telemetryState[key] = {
    ...telemetryState[key],
    ...next,
    updatedAt: Date.now(),
  };
  notifyTelemetry();
}

function push(history: number[], value: number): number[] {
  return history.slice(1).concat(value);
}

interface PollerConfig<K extends IntegrationKey> {
  id: K;
  capabilityId: string;
  url: string;
  intervalMs: number;
  apply: (payload: PollerPayloads[K]) => boolean;
  reset?: () => void;
}

function isDisabledPayload<T extends object>(
  payload: ApiEnvelope<T>,
): payload is { disabled: true } {
  return 'disabled' in payload && payload.disabled === true;
}

function isErrorPayload<T extends object>(payload: ApiEnvelope<T>): payload is { error: string } {
  return 'error' in payload && typeof payload.error === 'string';
}

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function startPoller<K extends IntegrationKey>(config: PollerConfig<K>): () => void {
  const { id, url, intervalMs, apply } = config;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
  };

  const tick = async () => {
    if (stopped) return;
    const connectivity = getConnectivity();
    if (connectivity.status === 'offline') {
      setTelemetryState(id, {
        status: 'stale',
        lastError: connectivity.reason,
        staleReason: connectivity.reason ?? 'Backend offline',
      });
      schedule(OFFLINE_BACKOFF_MS);
      return;
    }

    try {
      const res = await apiFetch(url);
      if (stopped) return;
      if (!res.ok) {
        setTelemetryState(id, {
          status: 'error',
          lastError: await readApiError(res),
          staleReason: 'Fetch failed',
        });
        schedule(effectiveIntervalMs(intervalMs));
        return;
      }
      const payload = (await res.json()) as ApiEnvelope<PollerPayloads[K]>;
      if (stopped) return;
      if (isDisabledPayload(payload)) {
        setTelemetryState(id, {
          status: 'disabled',
          lastError: null,
          staleReason: 'Integration disabled',
        });
        return;
      }
      if (isErrorPayload(payload)) {
        setTelemetryState(id, {
          status: 'error',
          lastError: payload.error,
          staleReason: 'Integration error',
        });
        schedule(effectiveIntervalMs(intervalMs));
        return;
      }
      if (apply(payload)) notify();
      setTelemetryState(id, {
        status: 'ok',
        lastOkAt: Date.now(),
        lastError: null,
        staleReason: null,
      });
    } catch (err) {
      setTelemetryState(id, {
        status: 'error',
        lastError: errorReason(err),
        staleReason: 'Fetch failed',
      });
      if (import.meta.env.DEV) console.warn(`[telemetry] ${url} failed:`, err);
    }
    schedule(effectiveIntervalMs(intervalMs));
  };

  tick();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function applyUnifi(payload: UnifiApiResponse): boolean {
  if (payload.unifi) state.unifi = payload.unifi;
  if (payload.network) {
    const net = payload.network;
    const prev = state.network;
    prev.downHistory = push(prev.downHistory, state.unifi.wan.down);
    prev.upHistory = push(prev.upHistory, state.unifi.wan.up);
    prev.latencyMs = net.latencyMs || prev.latencyMs;
    prev.latencyHistory = push(prev.latencyHistory, prev.latencyMs);
    prev.speedtest = net.speedtest || prev.speedtest;
    prev.uptime30d = net.uptime30d || prev.uptime30d;
    prev.publicIp = net.publicIp || prev.publicIp;
    if (net.dns?.length) prev.dns = net.dns;
  }
  return !!(payload.unifi || payload.network);
}

function applyProxmox(payload: ProxmoxApiResponse): boolean {
  if (!payload.proxmox) return false;
  state.proxmox = payload.proxmox;
  const node = payload.proxmox.node;
  const cluster = payload.proxmox.cluster;
  const cpuUsage = cluster?.cpuPct ?? node.cpu ?? 0;
  const cpuCores = cluster?.cpuTotal ?? node.cpuCores ?? 0;
  state.cpu = {
    ...state.cpu,
    model: node.cpuModel || state.cpu.model,
    cores: cpuCores,
    threads: cpuCores,
    usage: cpuUsage,
    target: cpuUsage,
    tempC: 0,
    tempTarget: 0,
    history: push(state.cpu.history, cpuUsage),
    tempHistory: push(state.cpu.tempHistory, 0),
    coreList: Array.from({ length: Math.min(cpuCores, 128) }, (_, i) => ({
      id: i,
      pct: cpuUsage,
      target: cpuUsage,
    })),
  };
  const ramPct = cluster?.memPct ?? node.ram ?? 0;
  state.ram = {
    ...state.ram,
    totalGB: Math.round(cluster?.memTotalGB ?? node.ramTotalGB ?? 0),
    usedGB: cluster?.memUsedGB ?? node.ramUsedGB ?? 0,
    target: ramPct,
    cachedGB: 0,
    history: push(state.ram.history, ramPct),
  };
  return true;
}

function applyDocker(payload: DockerApiResponse): boolean {
  if (!payload.docker) return false;
  state.docker = payload.docker;
  return true;
}

function applyGpu(payload: GpuApiResponse): boolean {
  if (!payload.gpu) return false;
  const incoming = payload.gpu;
  state.gpu = {
    ...state.gpu,
    ...incoming,
    history: push(state.gpu.history, incoming.usage || 0),
  };
  state.gpus = payload.gpus ?? [];
  state.gpuUnavailable = payload.unavailable ?? [];
  return true;
}

function storageStatus(status: string): StoragePool['status'] {
  if (status === 'online' || status === 'degraded' || status === 'offline') return status;
  return 'offline';
}

function applyUnas(payload: UnasApiResponse): boolean {
  if (!payload.unas) return false;
  state.unas = payload.unas;

  state.storage = {
    pools: payload.unas.pools.map((p): StoragePool => ({
      name: p.name,
      type: p.type,
      totalTB: p.totalTB,
      usedTB: p.usedTB,
      status: storageStatus(p.status),
      scrub: p.scrub?.lastRun ? p.scrub.lastRun : 'never',
    })),
    disks: payload.unas.disks.map((d): Disk => ({
      name: `Slot ${d.slot}`,
      model: d.model,
      tempC: d.tempC,
      smart: d.smart,
      ageHours: d.powerOnHours || 0,
    })),
  };
  return true;
}

function applySensors(payload: SensorsApiResponse): boolean {
  if (!payload.sensors) return false;
  state.sensors = payload.sensors;
  state.sensorNodes = payload.nodes ?? [];
  state.sensorsUnavailable = payload.unavailable ?? [];
  if (typeof payload.sensors.cpuTempC === 'number') {
    const t = payload.sensors.cpuTempC;
    state.cpu = {
      ...state.cpu,
      tempC: t,
      tempTarget: t,
      tempHistory: push(state.cpu.tempHistory, t),
    };
  }
  return true;
}

function applyAmt(payload: AmtApiResponse): boolean {
  if (!payload.amt) return false;
  state.amt = payload.amt;
  return true;
}

const POLLERS: { [K in IntegrationKey]: PollerConfig<K> } = {
  unifi: {
    id: 'unifi',
    capabilityId: 'network',
    url: '/api/unifi',
    intervalMs: UNIFI_POLL_MS,
    apply: applyUnifi,
    reset: () => {
      state.unifi = emptyUnifi();
      state.network = emptyNetwork();
    },
  },
  proxmox: {
    id: 'proxmox',
    capabilityId: 'datacenter',
    url: '/api/proxmox',
    intervalMs: PROXMOX_POLL_MS,
    apply: applyProxmox,
    reset: () => {
      const init = buildInit();
      state.proxmox = init.proxmox;
      state.cpu = init.cpu;
      state.ram = init.ram;
    },
  },
  docker: {
    id: 'docker',
    capabilityId: 'containers',
    url: '/api/docker',
    intervalMs: DOCKER_POLL_MS,
    apply: applyDocker,
    reset: () => {
      state.docker = buildInit().docker;
    },
  },
  gpu: {
    id: 'gpu',
    capabilityId: 'gpu',
    url: '/api/gpu',
    intervalMs: GPU_POLL_MS,
    apply: applyGpu,
    reset: () => {
      const init = buildInit();
      state.gpu = init.gpu;
      state.gpus = init.gpus;
      state.gpuUnavailable = init.gpuUnavailable;
    },
  },
  sensors: {
    id: 'sensors',
    capabilityId: 'sensors',
    url: '/api/sensors',
    intervalMs: SENSORS_POLL_MS,
    apply: applySensors,
    reset: () => {
      const init = buildInit();
      state.sensors = init.sensors;
      state.sensorNodes = init.sensorNodes;
      state.sensorsUnavailable = init.sensorsUnavailable;
      state.cpu = {
        ...state.cpu,
        tempC: 0,
        tempTarget: 0,
        tempHistory: zeros(),
      };
    },
  },
  unas: {
    id: 'unas',
    capabilityId: 'nas',
    url: '/api/unas',
    intervalMs: UNAS_POLL_MS,
    apply: applyUnas,
    reset: () => {
      state.unas = buildInit().unas;
      state.storage = buildInit().storage;
    },
  },
  amt: {
    id: 'amt',
    capabilityId: 'amt',
    url: '/api/amt',
    intervalMs: AMT_POLL_MS,
    apply: applyAmt,
    reset: () => {
      state.amt = emptyAmt();
    },
  },
};

export const INTEGRATION_KEYS = Object.keys(POLLERS) as IntegrationKey[];

const activeStops = new Map<IntegrationKey, () => void>();

const POLLER_STARTERS: Record<IntegrationKey, () => () => void> = {
  unifi: () => startPoller(POLLERS.unifi),
  proxmox: () => startPoller(POLLERS.proxmox),
  docker: () => startPoller(POLLERS.docker),
  gpu: () => startPoller(POLLERS.gpu),
  sensors: () => startPoller(POLLERS.sensors),
  unas: () => startPoller(POLLERS.unas),
  amt: () => startPoller(POLLERS.amt),
};

export function setIntegrationEnabled(key: IntegrationKey, enabled: boolean): void {
  const config = POLLERS[key];
  if (!config) return;
  const existing = activeStops.get(key);
  if (enabled) {
    if (existing) return;
    setTelemetryState(key, {
      status: 'idle',
      lastError: null,
      staleReason: null,
    });
    activeStops.set(key, POLLER_STARTERS[key]());
  } else {
    if (existing) {
      existing();
      activeStops.delete(key);
    }
    config.reset?.();
    setTelemetryState(key, {
      status: 'disabled',
      lastError: null,
      staleReason: 'Integration disabled by user',
    });
    notify();
  }
}

export function getTelemetryState(): Record<IntegrationKey, TelemetryIntegrationState> {
  return {
    unifi: { ...telemetryState.unifi },
    proxmox: { ...telemetryState.proxmox },
    docker: { ...telemetryState.docker },
    gpu: { ...telemetryState.gpu },
    sensors: { ...telemetryState.sensors },
    unas: { ...telemetryState.unas },
    amt: { ...telemetryState.amt },
  };
}

export function useTelemetryState(): Record<IntegrationKey, TelemetryIntegrationState> {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    telemetrySubs.add(fn);
    return () => {
      telemetrySubs.delete(fn);
    };
  }, []);
  return getTelemetryState();
}

export function useDashData(): DashboardState {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  return state;
}

export function getDashState(): DashboardState {
  return state;
}
