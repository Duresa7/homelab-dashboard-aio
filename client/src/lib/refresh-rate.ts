import { useEffect, useState } from 'react';

import { getState, setState, subscribe as subscribeState } from './store';

export type RefreshRate = 'realtime' | 'standard' | 'relaxed';

const STORAGE_KEY = 'refreshRate';
export const DEFAULT_REFRESH_RATE: RefreshRate = 'standard';

export const REFRESH_RATE_OPTIONS: { value: RefreshRate; label: string }[] = [
  { value: 'realtime', label: 'Real-time' },
  { value: 'standard', label: 'Standard' },
  { value: 'relaxed', label: 'Relaxed' },
];

const REALTIME_FLOOR_MS = 1000;
const REALTIME_SCALE = 0.2;
const RELAXED_SCALE = 3;

function normalize(value: unknown): RefreshRate {
  return value === 'realtime' || value === 'relaxed' ? value : DEFAULT_REFRESH_RATE;
}

export function getRefreshRate(): RefreshRate {
  return normalize(getState<unknown>(STORAGE_KEY, DEFAULT_REFRESH_RATE));
}

export function setRefreshRate(rate: RefreshRate): void {
  setState<RefreshRate>(STORAGE_KEY, rate);
}

export function useRefreshRate(): RefreshRate {
  const [rate, setRate] = useState<RefreshRate>(getRefreshRate);
  useEffect(() => subscribeState(STORAGE_KEY, () => setRate(getRefreshRate())), []);
  return rate;
}

export function effectiveIntervalMs(baseMs: number): number {
  switch (getRefreshRate()) {
    case 'realtime':
      return Math.max(REALTIME_FLOOR_MS, Math.round(baseMs * REALTIME_SCALE));
    case 'relaxed':
      return baseMs * RELAXED_SCALE;
    default:
      return baseMs;
  }
}

export function refreshRateDescription(rate: RefreshRate): string {
  switch (rate) {
    case 'realtime':
      return 'Polls every 1-2s for near-live data';
    case 'relaxed':
      return 'Polls 3x slower to reduce load';
    default:
      return 'Default polling (2-30s per source)';
  }
}
