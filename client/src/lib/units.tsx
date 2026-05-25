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

function readStoredUnit(): TempUnit {
  return getState<string>(STORAGE_KEY, 'F') === 'C' ? 'C' : 'F';
}

export function TempUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<TempUnit>(readStoredUnit);

  const setUnit = useCallback((u: TempUnit) => {
    setUnitState(u);
    setState<TempUnit>(STORAGE_KEY, u);
  }, []);

  const toggle = useCallback(() => {
    setUnitState((prev) => {
      const next = prev === 'F' ? 'C' : 'F';
      setState<TempUnit>(STORAGE_KEY, next);
      return next;
    });
  }, []);

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
