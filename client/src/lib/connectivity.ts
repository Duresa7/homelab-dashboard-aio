import { useSyncExternalStore } from 'react';

type Listener = () => void;
type ReconnectListener = () => void;

export type ConnectivityStatus = 'online' | 'offline' | 'unknown';
export type ConnectivityCode = 'BACKEND_UNREACHABLE' | null;

export interface ConnectivityState {
  status: ConnectivityStatus;
  reason: string | null;
  code: ConnectivityCode;
  lastChecked: number | null;
}

export type ConnectivityPingResult = { ok: true } | { ok: false; reason: string };

export interface ConnectivityModel {
  state: ConnectivityState;
  consecutiveFailures: number;
}

export interface ConnectivityTransition {
  model: ConnectivityModel;
  reconnected: boolean;
}

export const ONLINE_HEARTBEAT_MS = 5000;
export const OFFLINE_HEARTBEAT_MS = 2000;

const HEALTH_URL = '/api/health';
const HEARTBEAT_TIMEOUT_MS = 3000;
const OFFLINE_FAILURE_THRESHOLD = 2;

const INITIAL_STATE: ConnectivityState = {
  status: 'unknown',
  reason: null,
  code: null,
  lastChecked: null,
};

let model: ConnectivityModel = {
  state: INITIAL_STATE,
  consecutiveFailures: 0,
};
const listeners = new Set<Listener>();
const reconnectListeners = new Set<ReconnectListener>();
let heartbeatStarted = false;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let pingInFlight = false;

function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  ms = HEARTBEAT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

function notifyReconnect(): void {
  reconnectListeners.forEach((fn) => fn());
}

function sameState(a: ConnectivityState, b: ConnectivityState): boolean {
  return (
    a.status === b.status &&
    a.reason === b.reason &&
    a.code === b.code &&
    a.lastChecked === b.lastChecked
  );
}

export function getConnectivityIntervalMs(status: ConnectivityStatus): number {
  return status === 'offline' ? OFFLINE_HEARTBEAT_MS : ONLINE_HEARTBEAT_MS;
}

export function reduceConnectivity(
  previous: ConnectivityModel,
  result: ConnectivityPingResult,
  checkedAt: number,
): ConnectivityTransition {
  if (result.ok) {
    const nextStatus: ConnectivityStatus = 'online';
    return {
      model: {
        state: {
          status: nextStatus,
          reason: null,
          code: null,
          lastChecked: checkedAt,
        },
        consecutiveFailures: 0,
      },
      reconnected: previous.state.status === 'offline',
    };
  }

  const consecutiveFailures = previous.consecutiveFailures + 1;
  const shouldGoOffline = consecutiveFailures >= OFFLINE_FAILURE_THRESHOLD;
  const status = shouldGoOffline ? 'offline' : previous.state.status;

  return {
    model: {
      state: {
        status,
        reason: result.reason,
        code: shouldGoOffline ? 'BACKEND_UNREACHABLE' : null,
        lastChecked: checkedAt,
      },
      consecutiveFailures,
    },
    reconnected: false,
  };
}

export function getConnectivity(): ConnectivityState {
  return model.state;
}

export function subscribeConnectivity(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function onReconnect(fn: ReconnectListener): () => void {
  reconnectListeners.add(fn);
  return () => {
    reconnectListeners.delete(fn);
  };
}

export function useConnectivity(): ConnectivityState {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
}

function failureReason(error: unknown): string {
  if (error instanceof Error && error.message === 'Failed to fetch') return error.message;
  return 'Failed to fetch';
}

async function pingBackend(): Promise<ConnectivityPingResult> {
  try {
    const res = await fetchWithTimeout(HEALTH_URL);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
}

function scheduleNext(delayMs: number): void {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null;
    void runHeartbeat();
  }, delayMs);
}

async function runHeartbeat(): Promise<void> {
  if (pingInFlight) return;
  pingInFlight = true;
  try {
    const result = await pingBackend();
    const transition = reduceConnectivity(model, result, Date.now());
    const changed = !sameState(model.state, transition.model.state);
    model = transition.model;
    if (changed) notify();
    if (transition.reconnected) notifyReconnect();
  } finally {
    pingInFlight = false;
    scheduleNext(getConnectivityIntervalMs(model.state.status));
  }
}

export function startHeartbeat(): void {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  scheduleNext(0);
}
