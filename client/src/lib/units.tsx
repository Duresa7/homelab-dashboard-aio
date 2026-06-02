import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { getState, setState, subscribe as subscribeState } from './store';

export type TempUnit = 'F' | 'C';
const STORAGE_KEY = 'tempUnit';

interface Ctx {
  unit: TempUnit;
  setUnit: (u: TempUnit) => void;
  toggle: () => void;
}

const UnitContext = createContext<Ctx>({
  unit: 'F',
  setUnit: () => {},
  toggle: () => {},
});

function normalizeUnit(value: unknown): TempUnit {
  if (typeof value !== 'string') return 'F';
  const raw = value.trim();
  const parsed = raw.startsWith('"') ? (() => {
    try { return JSON.parse(raw); } catch { return raw; }
  })() : raw;
  return String(parsed).trim().toUpperCase() === 'C' ? 'C' : 'F';
}

function readStoredUnit(): TempUnit {
  return normalizeUnit(getState<unknown>(STORAGE_KEY, 'F'));
}

export function TempUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<TempUnit>(readStoredUnit);

  const setUnit = useCallback((u: TempUnit) => {
    setUnitState(u);
    setState<TempUnit>(STORAGE_KEY, u);
  }, []);

  const toggle = useCallback(() => {
    const next = readStoredUnit() === 'F' ? 'C' : 'F';
    setUnit(next);
  }, [setUnit]);

  useEffect(() => {
    return subscribeState(STORAGE_KEY, () => setUnitState(readStoredUnit()));
  }, []);

  return (
    <UnitContext.Provider value={{ unit, setUnit, toggle }}>
      {children}
    </UnitContext.Provider>
  );
}

export function useTempUnit(): Ctx {
  return useContext(UnitContext);
}

export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

export function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function convertTemp(tempC: number, unit: TempUnit): number {
  return unit === 'F' ? cToF(tempC) : tempC;
}

export function fmtTemp(
  tempC: number | null | undefined,
  unit: TempUnit,
  opts: { digits?: number; suffix?: boolean; placeholder?: string } = {},
): string {
  const { digits = 0, suffix = true, placeholder = '—' } = opts;
  if (tempC == null || Number.isNaN(tempC)) return placeholder;
  const v = unit === 'F' ? cToF(tempC) : tempC;
  const num = v.toFixed(digits);
  return suffix ? `${num}°${unit}` : num;
}

export function tempSuffix(unit: TempUnit): string {
  return `°${unit}`;
}
