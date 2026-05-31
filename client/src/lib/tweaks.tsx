import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getState, setState } from './store';

const STORAGE_KEY = 'tweaks';

export function useTweaks<T extends object>(defaults: T): [T, <K extends keyof T>(k: K, v: T[K]) => void] {
  const [values, setValues] = useState<T>(() => {
    const stored = getState<Partial<T> | null>(STORAGE_KEY, null);
    return stored ? { ...defaults, ...stored } : defaults;
  });

  const setTweak = useCallback(<K extends keyof T>(key: K, val: T[K]) => {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      setState<T>(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return [values, setTweak];
}

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
}

export function TweaksPanel({ open, onOpenChange, title = 'Customize', children }: PanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[330px] flex-col gap-0 p-0 sm:w-[360px]">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="font-display text-base">{title}</SheetTitle>
          <SheetDescription className="sr-only">Appearance and dashboard preferences</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function TweakSection({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <>
      <div className="pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground first:pt-0">
        {label}
      </div>
      {children}
    </>
  );
}

export function TweakRow({
  label,
  value,
  children,
  inline,
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {value != null && <span className="text-xs tabular-nums text-muted-foreground">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function TweakToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-normal text-foreground">{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

interface RadioOption<T> {
  value: T;
  label: string;
}

export function TweakRadio<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<RadioOption<T> | T>;
  onChange: (v: T) => void;
}) {
  const opts = useMemo<RadioOption<T>[]>(
    () => options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) })),
    [options],
  );
  return (
    <TweakRow label={label}>
      <div role="radiogroup" className="flex gap-1 rounded-lg bg-muted p-1">
        {opts.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-[13px] font-medium capitalize transition-colors',
              o.value === value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

interface SelectOption<T> {
  value: T;
  label: string;
}

export function TweakSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SelectOption<T> | T>;
  onChange: (v: T) => void;
}) {
  const opts = options.map((o) =>
    typeof o === 'object' ? o : ({ value: o, label: String(o) } as SelectOption<T>),
  );
  return (
    <TweakRow label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={String(o.value)} value={String(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </TweakRow>
  );
}

export function TweakColor({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <TweakRow label={label}>
      <div className="flex gap-2" role="radiogroup">
        {options.map((c) => {
          const on = c.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              style={{ background: c }}
              onClick={() => onChange(c)}
              aria-label={c}
              title={c}
              className={cn(
                'h-8 flex-1 rounded-md ring-offset-background transition-transform hover:-translate-y-0.5',
                on ? 'ring-2 ring-foreground ring-offset-2' : 'ring-1 ring-black/10',
              )}
            />
          );
        })}
      </div>
    </TweakRow>
  );
}

export function useSystemTheme(): 'light' | 'dark' {
  const [pref, setPref] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  );
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = (e: MediaQueryListEvent) => setPref(e.matches ? 'dark' : 'light');
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return pref;
}
