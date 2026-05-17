import { useEffect, useState } from 'react';
import type { DashboardState, UnifiData, NetworkData, ProtectData } from '../types';

const N_HISTORY = 60;
const UNIFI_POLL_MS = 2000;
const PROXMOX_POLL_MS = 5000;
const DOCKER_POLL_MS = 10000;
const GPU_POLL_MS = 5000;
const SENSORS_POLL_MS = 5000;
const UNAS_POLL_MS = 30000;
const PROTECT_POLL_MS = 10000;

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
    firewall: { zones: 0, policies: 0, policiesEnabled: 0 },
    vpnServers: [],
    dnsRecords: [],
    appVersion: null,
  };
}

function emptyProtect(): ProtectData {
  return {
    cameras: [],
    total: 0,
    connected: 0,
    disconnected: 0,
    nvr: null,
    appVersion: null,
    recentEvents: [],
    eventsConnected: false,
  };
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
    fans: [],
    storage: { pools: [], disks: [] },
    docker: { running: 0, stopped: 0, total: 0, updates: 0, hosts: [], containers: [] },
    proxmox: {
      nodes: 0,
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
    protect: emptyProtect(),
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
  };
}

let state: DashboardState = buildInit();
const subs = new Set<() => void>();

function notify(): void {
  subs.forEach((fn) => fn());
}

function push(history: number[], value: number): number[] {
  return history.slice(1).concat(value);
}

interface PollerOptions {
  url: string;
  intervalMs: number;
  apply: (payload: any) => boolean;
}

function startPoller({ url, intervalMs, apply }: PollerOptions): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const payload = await res.json();
      if (payload.disabled) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        return;
      }
      if (payload.error) return;
      if (apply(payload)) notify();
    } catch (err) {
      if (import.meta.env.DEV) console.warn(`[telemetry] ${url} failed:`, err);
    }
  };

  tick();
  timer = setInterval(tick, intervalMs);
}

function applyUnifi(payload: any): boolean {
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

function applyProxmox(payload: any): boolean {
  if (!payload.proxmox) return false;
  state.proxmox = payload.proxmox;
  // Mirror Proxmox node telemetry into the global CPU / RAM tiles so the
  // generic CPUTile / RAMTile widgets render real data on the Proxmox page.
  const node = payload.proxmox.node;
  const cpuUsage = node.cpu || 0;
  state.cpu = {
    ...state.cpu,
    model: node.cpuModel || state.cpu.model,
    cores: node.cpuCores || state.cpu.cores,
    threads: node.cpuThreads || state.cpu.threads,
    usage: cpuUsage,
    target: cpuUsage,
    tempC: 0,
    tempTarget: 0,
    history: push(state.cpu.history, cpuUsage),
    tempHistory: push(state.cpu.tempHistory, 0),
    coreList: Array.from({ length: node.cpuCores || 0 }, (_, i) => ({
      id: i,
      pct: cpuUsage,
      target: cpuUsage,
    })),
  };
  const ramPct = node.ram || 0;
  state.ram = {
    ...state.ram,
    totalGB: Math.round(node.ramTotalGB || 0),
    usedGB: node.ramUsedGB || 0,
    target: ramPct,
    cachedGB: 0,
    history: push(state.ram.history, ramPct),
  };
  return true;
}

function applyDocker(payload: any): boolean {
  if (!payload.docker) return false;
  state.docker = payload.docker;
  return true;
}

function applyGpu(payload: any): boolean {
  if (!payload.gpu) return false;
  const incoming = payload.gpu;
  state.gpu = {
    ...state.gpu,
    ...incoming,
    history: push(state.gpu.history, incoming.usage || 0),
  };
  return true;
}

function applyUnas(payload: any): boolean {
  if (!payload.unas) return false;
  state.unas = payload.unas;
  // Mirror UNAS pools and disks into the generic storage state so the
  // StorageTile, SmartTile, and Storage page's All Disks table populate.
  // If more storage sources are added later, this becomes a merge.
  state.storage = {
    pools: payload.unas.pools.map((p: any) => ({
      name: p.name,
      type: p.type,
      totalTB: p.totalTB,
      usedTB: p.usedTB,
      status: p.status,
      scrub: p.scrub?.lastRun ? p.scrub.lastRun : 'never',
    })),
    disks: payload.unas.disks.map((d: any) => ({
      name: `Slot ${d.slot}`,
      model: d.model,
      tempC: d.tempC,
      smart: d.smart,
      ageHours: d.powerOnHours || 0,
    })),
  };
  return true;
}

function applyProtect(payload: any): boolean {
  if (!payload.protect) return false;
  state.protect = payload.protect;
  return true;
}

function applySensors(payload: any): boolean {
  if (!payload.sensors) return false;
  state.sensors = payload.sensors;
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

let tickerStarted = false;
function startTicker(): void {
  if (tickerStarted) return;
  tickerStarted = true;
  startPoller({ url: '/api/unifi', intervalMs: UNIFI_POLL_MS, apply: applyUnifi });
  startPoller({ url: '/api/proxmox', intervalMs: PROXMOX_POLL_MS, apply: applyProxmox });
  startPoller({ url: '/api/docker', intervalMs: DOCKER_POLL_MS, apply: applyDocker });
  startPoller({ url: '/api/gpu', intervalMs: GPU_POLL_MS, apply: applyGpu });
  startPoller({ url: '/api/sensors', intervalMs: SENSORS_POLL_MS, apply: applySensors });
  startPoller({ url: '/api/unas', intervalMs: UNAS_POLL_MS, apply: applyUnas });
  startPoller({ url: '/api/protect', intervalMs: PROTECT_POLL_MS, apply: applyProtect });
}

export function useDashData(): DashboardState {
  const [, force] = useState(0);
  useEffect(() => {
    startTicker();
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
