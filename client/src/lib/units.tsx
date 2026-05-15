import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type TempUnit = 'F' | 'C';
const STORAGE_KEY = 'homelab-dashboard.tempUnit';

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

export function TempUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<TempUnit>(() => {
    if (typeof window === 'undefined') return 'F';
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw === 'C' ? 'C' : 'F';
    } catch {
      return 'F';
    }
  });

  const setUnit = useCallback((u: TempUnit) => {
    setUnitState(u);
    try {
      window.localStorage.setItem(STORAGE_KEY, u);
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => {
    setUnitState((prev) => {
      const next = prev === 'F' ? 'C' : 'F';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'F' || e.newValue === 'C')) {
        setUnitState(e.newValue);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
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
  if (tempC == null || Number.isNaN(tempC)) {
    return suffix ? `${placeholder}` : placeholder;
  }
  const v = unit === 'F' ? cToF(tempC) : tempC;
  const num = v.toFixed(digits);
  return suffix ? `${num}°${unit}` : num;
}

export function tempSuffix(unit: TempUnit): string {
  return `°${unit}`;
}
