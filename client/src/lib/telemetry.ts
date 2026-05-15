import { useEffect, useState } from 'react';
import type { DashboardState, UnifiData, NetworkData } from '../types';

const N_HISTORY = 60;
const UNIFI_POLL_MS = 500;
const PROXMOX_POLL_MS = 5000;

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
      node: { name: '—', cpu: 0, ram: 0, uptime: '—', version: '—' },
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
  };
}

let state: DashboardState = buildInit();
const subs = new Set<() => void>();

let unifiDisabled = false;
let proxmoxDisabled = false;
let unifiTimer: ReturnType<typeof setInterval> | null = null;
let proxmoxTimer: ReturnType<typeof setInterval> | null = null;

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
  unifiTimer = setInterval(() => {
    if (unifiDisabled) return;
    fetchUnifi();
  }, UNIFI_POLL_MS);
  proxmoxTimer = setInterval(() => {
    if (proxmoxDisabled) return;
    fetchProxmox();
  }, PROXMOX_POLL_MS);
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
