import { useSyncExternalStore } from 'react';

import { getState, setState, subscribe as subscribeState } from './store';

export interface ThresholdPair {
  warn: number;
  bad: number;
}

export interface Thresholds {
  cpuUsage: ThresholdPair;
  cpuTemp: ThresholdPair;
  ramUsage: ThresholdPair;
  gpuUsage: ThresholdPair;
  gpuTemp: ThresholdPair;
  diskTemp: ThresholdPair;
  storageFill: ThresholdPair;
  fan: ThresholdPair;
  ping: ThresholdPair;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  cpuUsage: { warn: 70, bad: 90 },
  cpuTemp: { warn: 65, bad: 75 },
  ramUsage: { warn: 75, bad: 90 },
  gpuUsage: { warn: 75, bad: 95 },
  gpuTemp: { warn: 68, bad: 78 },
  diskTemp: { warn: 45, bad: 55 },
  storageFill: { warn: 80, bad: 92 },
  fan: { warn: 70, bad: 90 },
  ping: { warn: 40, bad: 80 },
};

export const THRESHOLD_LABELS: Record<keyof Thresholds, { label: string; unit: string }> = {
  cpuUsage: { label: 'CPU usage', unit: '%' },
  cpuTemp: { label: 'CPU temp', unit: '°C' },
  ramUsage: { label: 'RAM usage', unit: '%' },
  gpuUsage: { label: 'GPU usage', unit: '%' },
  gpuTemp: { label: 'GPU temp', unit: '°C' },
  diskTemp: { label: 'Disk temp', unit: '°C' },
  storageFill: { label: 'Storage fill', unit: '%' },
  fan: { label: 'Fan', unit: '%' },
  ping: { label: 'Ping', unit: 'ms' },
};

const STORAGE_KEY = 'thresholds';
const listeners = new Set<() => void>();
let current: Thresholds = load();

subscribeState(STORAGE_KEY, () => {
  current = load();
  listeners.forEach((fn) => fn());
});

function load(): Thresholds {
  const parsed = getState<Partial<Thresholds> | null>(STORAGE_KEY, null);
  if (!parsed) return DEFAULT_THRESHOLDS;
  const merged = { ...DEFAULT_THRESHOLDS } as Thresholds;
  for (const k of Object.keys(DEFAULT_THRESHOLDS) as Array<keyof Thresholds>) {
    const p = parsed[k];
    if (p && typeof p.warn === 'number' && typeof p.bad === 'number') {
      merged[k] = { warn: p.warn, bad: p.bad };
    }
  }
  return merged;
}

function persist() {
  setState<Thresholds>(STORAGE_KEY, current);
}

export function getThresholds(): Thresholds {
  return current;
}

export function setThreshold<K extends keyof Thresholds>(key: K, pair: ThresholdPair): void {
  current = { ...current, [key]: pair };
  persist();
  listeners.forEach((fn) => fn());
}

export function resetThresholds(): void {
  current = DEFAULT_THRESHOLDS;
  persist();
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useThresholds(): Thresholds {
  return useSyncExternalStore(subscribe, getThresholds, getThresholds);
}
