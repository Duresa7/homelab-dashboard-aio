import { useEffect, useState } from 'react';

import { getState, setState, subscribe as subscribeState } from './store';

/**
 * User-adjustable cap on how many rows list cards show (connected clients,
 * recent events, ...). `0` means "show all". Persisted via /api/state.
 */
const STORAGE_KEY = 'listRows';

export const DEFAULT_LIST_ROWS = 5;

/** Choices offered in Settings → Preferences. 0 = no cap. */
export const LIST_ROWS_OPTIONS = [3, 5, 8, 10, 15, 25, 0] as const;

export function listRowsLabel(rows: number): string {
  return rows === 0 ? 'All' : String(rows);
}

function readStoredRows(): number {
  const raw = getState<unknown>(STORAGE_KEY, DEFAULT_LIST_ROWS);
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LIST_ROWS;
  return Math.floor(n);
}

export function setListRows(rows: number): void {
  setState<number>(STORAGE_KEY, rows);
}

export function useListRows(): number {
  const [rows, setRows] = useState<number>(readStoredRows);
  useEffect(() => subscribeState(STORAGE_KEY, () => setRows(readStoredRows())), []);
  return rows;
}

/** Apply the row cap; a cap of 0 returns the full list. */
export function capList<T>(items: T[], rows: number): T[] {
  return rows > 0 ? items.slice(0, rows) : items;
}
