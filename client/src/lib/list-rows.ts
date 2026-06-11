import { useEffect, useState } from 'react';

import { getState, setState, subscribe as subscribeState } from './store';

const STORAGE_KEY = 'listRows';

export const DEFAULT_LIST_ROWS = 5;

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

export function capList<T>(items: T[], rows: number): T[] {
  return rows > 0 ? items.slice(0, rows) : items;
}
