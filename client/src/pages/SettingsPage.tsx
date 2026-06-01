import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { StatusBadge } from '@/components/common';
import { cn } from '@/lib/utils';
import { INTEGRATIONS, type HealthInfo, type HealthResponse } from '../lib/integrations';
import type { IntegrationKey } from '../lib/telemetry';
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_LABELS,
  resetThresholds,
  setThreshold,
  useThresholds,
  type Thresholds,
} from '../lib/thresholds';

interface Props {
  integrations: Record<IntegrationKey, boolean>;
  onChange: (integrations: Record<IntegrationKey, boolean>) => void;
}

interface ServerHealthState {
  data: HealthResponse | null;
  error: string | null;
  loading: boolean;
}

function useServerHealth(): ServerHealthState {
  const [state, setState] = useState<ServerHealthState>({ data: null, error: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as HealthResponse;
        if (cancelled) return;
        setState({ data, error: null, loading: false });
      } catch (err) {
        if (cancelled) return;
        setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false });
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function asHealthInfo(value: unknown): HealthInfo | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.enabled !== 'boolean') return null;
  return { enabled: v.enabled, configured: !!v.configured };
}

interface StatusPill {
  kind: 'ok' | 'warn' | 'bad' | 'info';
  label: string;
  hint: string;
}

function serverStatus(info: HealthInfo | null): StatusPill {
  if (!info) return { kind: 'info', label: 'unknown', hint: 'No status reported by the server.' };
  if (!info.enabled)
    return { kind: 'info', label: 'server disabled', hint: 'Set *_ENABLED=true in .env to allow this integration server-side.' };
  if (!info.configured)
    return { kind: 'warn', label: 'not configured', hint: 'The server allows this integration but credentials/host are missing in .env.' };
  return { kind: 'ok', label: 'configured', hint: 'Server configuration is present for this integration.' };
}

function NumberStepper({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-input bg-background">
      <button
        type="button"
        className="grid size-7 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`Decrease ${ariaLabel}`}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={12} strokeWidth={2.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        className="w-10 border-x border-input bg-transparent py-1 text-center text-sm tabular-nums text-foreground outline-none"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          onChange(v);
        }}
      />
      <button
        type="button"
        className="grid size-7 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`Increase ${ariaLabel}`}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function ThresholdRow({ k, thresholds }: { k: keyof Thresholds; thresholds: Thresholds }) {
  const { label, unit } = THRESHOLD_LABELS[k];
  const pair = thresholds[k];
  const def = DEFAULT_THRESHOLDS[k];
  const isCustom = pair.warn !== def.warn || pair.bad !== def.bad;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60">
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {label}
        {isCustom ? <span className="size-1.5 rounded-full bg-primary" title={`default ${def.warn}/${def.bad}`} /> : null}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-warn">warn</span>
          <NumberStepper value={pair.warn} ariaLabel={`${label} warn threshold`} onChange={(v) => setThreshold(k, { ...pair, warn: v })} />
          <span className="w-4 text-xs text-muted-foreground">{unit}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-bad">bad</span>
          <NumberStepper value={pair.bad} ariaLabel={`${label} bad threshold`} onChange={(v) => setThreshold(k, { ...pair, bad: v })} />
          <span className="w-4 text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({ integrations, onChange }: Props) {
  const thresholds = useThresholds();
  const { data, error, loading } = useServerHealth();
  const total = INTEGRATIONS.length;
  const enabledCount = INTEGRATIONS.reduce((n, def) => n + (integrations[def.key] ? 1 : 0), 0);
  const allOn = enabledCount === total;
  const allOff = enabledCount === 0;

  const setOne = (key: IntegrationKey, value: boolean) => onChange({ ...integrations, [key]: value });
  const setAll = (value: boolean) => {
    const next = { ...integrations };
    for (const def of INTEGRATIONS) next[def.key] = value;
    onChange(next);
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-[var(--page-gap)]">
      <section className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-lg tracking-tight text-foreground">Integrations</h2>
            <span className="text-sm tabular-nums text-muted-foreground">{enabledCount} / {total} active</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={allOn} onClick={() => setAll(true)}>Enable all</Button>
            <Button variant="outline" size="sm" disabled={allOff} onClick={() => setAll(false)}>Disable all</Button>
          </div>
        </header>

        {error ? (
          <div className="flex items-center gap-3 rounded-lg border border-l-2 border-border border-l-[var(--bad)] bg-[color-mix(in_oklab,var(--bad)_6%,var(--card))] px-3.5 py-2.5">
            <span className="size-2 shrink-0 rounded-full bg-[var(--bad)]" />
            <div className="flex flex-col">
              <b className="text-sm font-semibold text-foreground">Server health check failed</b>
              <span className="text-sm text-muted-foreground">{error}</span>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map((def) => {
            const enabled = !!integrations[def.key];
            const info = data ? asHealthInfo(data[def.healthField]) : null;
            const status = serverStatus(info);
            const pollLabel = loading
              ? 'checking server…'
              : !enabled
                ? 'paused — no API calls'
                : info && !info.enabled
                  ? 'not polling (server off)'
                  : `polling /api/${def.key}`;
            return (
              <div
                key={def.key}
                className={cn(
                  'flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card transition-colors',
                  enabled ? 'border-border' : 'border-border/60 opacity-75',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{def.label}</span>
                  <Switch checked={enabled} aria-label={`Toggle ${def.label}`} onCheckedChange={(v) => setOne(def.key, v)} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind={status.kind} title={status.hint}>
                    server: {status.label}
                  </StatusBadge>
                  <span className="truncate text-xs text-muted-foreground" title={pollLabel}>{pollLabel}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg tracking-tight text-foreground">Severity Thresholds</h2>
          <Button variant="outline" size="sm" onClick={() => resetThresholds()}>Reset to defaults</Button>
        </header>
        <div className="grid grid-cols-1 gap-1 rounded-xl border border-border bg-card p-2 shadow-card lg:grid-cols-2">
          {(Object.keys(THRESHOLD_LABELS) as Array<keyof Thresholds>).map((k) => (
            <ThresholdRow key={k} k={k} thresholds={thresholds} />
          ))}
        </div>
      </section>
    </div>
  );
}
