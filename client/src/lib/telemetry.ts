import { useEffect, useState } from 'react';
import type { DashboardState, UnifiData, NetworkData } from '../types';

const N_HISTORY = 60;
const UNIFI_POLL_MS = 500;
const PROXMOX_POLL_MS = 5000;
const GPU_POLL_MS = 5000;
const SENSORS_POLL_MS = 5000;

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

function emptyNetwork(): NetworkData {
  return {
    downHistory: Array(N_HISTORY).fill(0),
    upHistory: Array(N_HISTORY).fill(0),
    latencyMs: 0,
    latencyHistory: Array(N_HISTORY).fill(0),
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
      history: Array(N_HISTORY).fill(0),
      tempHistory: Array(N_HISTORY).fill(0),
      coreList: [],
    },
    ram: {
      totalGB: 0,
      usedGB: 0,
      target: 0,
      cachedGB: 0,
      history: Array(N_HISTORY).fill(0),
    },
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
      history: Array(N_HISTORY).fill(0),
    },
    fans: [],
    storage: { pools: [], disks: [] },
    docker: {
      running: 0,
      stopped: 0,
      total: 0,
      updates: 0,
      hosts: [],
      containers: [],
    },
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
      coresAllocated: 0,
      coresTotal: 0,
    },
    unifi: emptyUnifi(),
    unas: {
      model: '—',
      tempC: 0,
      fanRpm: 0,
      uptime: '—',
      pools: [],
      shares: [],
    },
    network: emptyNetwork(),
    backups: [],
    ups: { model: '—', loadW: 0, loadPct: 0, batteryPct: 0, runtimeMin: 0, status: '—' },
    events: [],
    alerts: [],
    sensors: { cpuTempC: null, systemTempC: null, systemTempLabel: null, cores: [], disks: [], memory: [], network: [], fans: [], other: [] },
  };
}

let state: DashboardState = buildInit();
const subs = new Set<() => void>();

let unifiDisabled = false;
let proxmoxDisabled = false;
let gpuDisabled = false;
let sensorsDisabled = false;
let unifiTimer: ReturnType<typeof setInterval> | null = null;
let proxmoxTimer: ReturnType<typeof setInterval> | null = null;
let gpuTimer: ReturnType<typeof setInterval> | null = null;
let sensorsTimer: ReturnType<typeof setInterval> | null = null;

async function fetchUnifi(): Promise<void> {
  try {
    const res = await fetch('/api/unifi');
    if (!res.ok) return;
    const payload = await res.json();
    if (payload.disabled) {
      unifiDisabled = true;
      if (unifiTimer) { clearInterval(unifiTimer); unifiTimer = null; }
      return;
    }
    if (payload.error) return;

    if (payload.unifi) {
      state.unifi = payload.unifi;
    }

    if (payload.network) {
      const net = payload.network;
      const prev = state.network;
      const dn = state.unifi.wan.down;
      const up = state.unifi.wan.up;
      prev.downHistory = prev.downHistory.slice(1).concat(dn);
      prev.upHistory = prev.upHistory.slice(1).concat(up);
      prev.latencyMs = net.latencyMs || prev.latencyMs;
      prev.latencyHistory = prev.latencyHistory.slice(1).concat(prev.latencyMs);
      prev.speedtest = net.speedtest || prev.speedtest;
      prev.uptime30d = net.uptime30d || prev.uptime30d;
      prev.publicIp = net.publicIp || prev.publicIp;
      if (net.dns?.length) prev.dns = net.dns;
    }

    subs.forEach((fn) => fn());
  } catch {
    // backend not reachable — keep existing state
  }
}

async function fetchProxmox(): Promise<void> {
  try {
    const res = await fetch('/api/proxmox');
    if (!res.ok) return;
    const payload = await res.json();
    if (payload.disabled) {
      proxmoxDisabled = true;
      if (proxmoxTimer) { clearInterval(proxmoxTimer); proxmoxTimer = null; }
      return;
    }
    if (payload.error) return;
    if (payload.proxmox) {
      state.proxmox = payload.proxmox;
      // Mirror Proxmox node telemetry into the global CPU / RAM tiles so the
      // generic CPUTile / RAMTile widgets on the Proxmox page render real data.
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
        history: state.cpu.history.slice(1).concat(cpuUsage),
        tempHistory: state.cpu.tempHistory.slice(1).concat(0),
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
        history: state.ram.history.slice(1).concat(ramPct),
      };
      subs.forEach((fn) => fn());
    }
  } catch {
    // backend not reachable — keep existing state
  }
}

async function fetchGpu(): Promise<void> {
  try {
    const res = await fetch('/api/gpu');
    if (!res.ok) return;
    const payload = await res.json();
    if (payload.disabled) {
      gpuDisabled = true;
      if (gpuTimer) { clearInterval(gpuTimer); gpuTimer = null; }
      return;
    }
    if (payload.error) return;
    if (payload.gpu) {
      const incoming = payload.gpu;
      state.gpu = {
        ...state.gpu,
        ...incoming,
        history: state.gpu.history.slice(1).concat(incoming.usage || 0),
      };
      subs.forEach((fn) => fn());
    }
  } catch {
    // backend not reachable — keep existing state
  }
}

async function fetchSensors(): Promise<void> {
  try {
    const res = await fetch('/api/sensors');
    if (!res.ok) return;
    const payload = await res.json();
    if (payload.disabled) {
      sensorsDisabled = true;
      if (sensorsTimer) { clearInterval(sensorsTimer); sensorsTimer = null; }
      return;
    }
    if (payload.error) return;
    if (payload.sensors) {
      state.sensors = payload.sensors;
      // Mirror CPU temp into the global CPU widget so the CPU tile shows real temp
      if (typeof payload.sensors.cpuTempC === 'number') {
        const t = payload.sensors.cpuTempC;
        state.cpu = {
          ...state.cpu,
          tempC: t,
          tempTarget: t,
          tempHistory: state.cpu.tempHistory.slice(1).concat(t),
        };
      }
      subs.forEach((fn) => fn());
    }
  } catch {
    // backend not reachable — keep existing state
  }
}

let tickerStarted = false;
function startTicker(): void {
  if (tickerStarted) return;
  tickerStarted = true;
  fetchUnifi();
  fetchProxmox();
  fetchGpu();
  fetchSensors();
  unifiTimer = setInterval(() => {
    if (unifiDisabled) return;
    fetchUnifi();
  }, UNIFI_POLL_MS);
  proxmoxTimer = setInterval(() => {
    if (proxmoxDisabled) return;
    fetchProxmox();
  }, PROXMOX_POLL_MS);
  gpuTimer = setInterval(() => {
    if (gpuDisabled) return;
    fetchGpu();
  }, GPU_POLL_MS);
  sensorsTimer = setInterval(() => {
    if (sensorsDisabled) return;
    fetchSensors();
  }, SENSORS_POLL_MS);
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
