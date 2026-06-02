import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Clock3,
  Gauge,
  Globe2,
  LayoutGrid,
  Minus,
  MonitorCog,
  PlugZap,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Thermometer,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/common';
import { cn } from '@/lib/utils';
import { ALL_TILES, type TileId } from '../components/widgets';
import { INTEGRATIONS, type HealthInfo, type HealthResponse } from '../lib/integrations';
import type { IntegrationKey } from '../lib/telemetry';
import { convertTemp, fToC, useTempUnit, type TempUnit } from '../lib/units';
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  TIME_ZONE_OPTIONS,
  formatClockDate,
  formatClockTime,
  timeZoneLabel,
  type DateFormat,
  type DateTimePreferences,
  type TimeFormat,
  type TimeZoneChoice,
} from '../lib/datetime';
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_LABELS,
  resetThresholds,
  setThreshold,
  useThresholds,
  type Thresholds,
} from '../lib/thresholds';

type ThemeChoice = 'light' | 'dark' | 'system';
type Density = 'compact' | 'regular' | 'comfy';
export type SettingsTabId = 'preferences' | 'integrations' | 'severity';

export interface SettingsPreferences {
  theme: ThemeChoice;
  density: Density;
  showAlerts: boolean;
  overviewLayout: TileId[];
  dateTime: DateTimePreferences;
}

interface Props {
  integrations: Record<IntegrationKey, boolean>;
  preferences: SettingsPreferences;
  tab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  onIntegrationChange: (integrations: Record<IntegrationKey, boolean>) => void;
  onPreferenceChange: <K extends keyof SettingsPreferences>(
    key: K,
    value: SettingsPreferences[K],
  ) => void;
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
        setState({
          data: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        });
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
    return {
      kind: 'info',
      label: 'server disabled',
      hint: 'Set *_ENABLED=true in .env to allow this integration server-side.',
    };
  if (!info.configured)
    return {
      kind: 'warn',
      label: 'not configured',
      hint: 'The server allows this integration but credentials/host are missing in .env.',
    };
  return {
    kind: 'ok',
    label: 'configured',
    hint: 'Server configuration is present for this integration.',
  };
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
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
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
        inputMode="decimal"
        className="w-11 border-x border-input bg-transparent py-1 text-center text-sm tabular-nums text-foreground outline-none"
        value={shown}
        aria-label={ariaLabel}
        onChange={(e) => {
          if (e.target.value.trim() === '') return;
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

function isTempThreshold(k: keyof Thresholds): boolean {
  return k === 'cpuTemp' || k === 'gpuTemp' || k === 'diskTemp';
}

function displayThreshold(k: keyof Thresholds, valueC: number, unit: TempUnit): number {
  if (!isTempThreshold(k)) return valueC;
  return Math.round(convertTemp(valueC, unit));
}

function storedThreshold(k: keyof Thresholds, value: number, unit: TempUnit): number {
  if (!isTempThreshold(k)) return value;
  return unit === 'F' ? fToC(value) : value;
}

function ThresholdRow({
  k,
  thresholds,
  unit,
}: {
  k: keyof Thresholds;
  thresholds: Thresholds;
  unit: TempUnit;
}) {
  const { label, unit: baseUnit } = THRESHOLD_LABELS[k];
  const pair = thresholds[k];
  const def = DEFAULT_THRESHOLDS[k];
  const isCustom = pair.warn !== def.warn || pair.bad !== def.bad;
  const displayUnit = isTempThreshold(k) ? `°${unit}` : baseUnit;
  const defWarn = displayThreshold(k, def.warn, unit);
  const defBad = displayThreshold(k, def.bad, unit);
  const update = (side: 'warn' | 'bad', value: number) => {
    setThreshold(k, { ...pair, [side]: storedThreshold(k, value, unit) });
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60">
      <div className="flex min-w-[9rem] items-center gap-1.5 text-sm font-medium text-foreground">
        {label}
        {isCustom ? (
          <span
            className="size-1.5 rounded-full bg-primary"
            title={`default ${defWarn}/${defBad} ${displayUnit}`}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-warn">warn</span>
          <NumberStepper
            value={displayThreshold(k, pair.warn, unit)}
            ariaLabel={`${label} warn threshold`}
            onChange={(v) => update('warn', v)}
          />
          <span className="w-6 text-xs text-muted-foreground">{displayUnit}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-bad">bad</span>
          <NumberStepper
            value={displayThreshold(k, pair.bad, unit)}
            ariaLabel={`${label} bad threshold`}
            onChange={(v) => update('bad', v)}
          />
          <span className="w-6 text-xs text-muted-foreground">{displayUnit}</span>
        </div>
      </div>
    </div>
  );
}

interface Choice<T extends string> {
  value: T;
  label: string;
}

function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<Choice<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" className="flex gap-1 rounded-lg bg-muted p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-8 flex-1 rounded-md px-3 text-sm font-medium transition-colors',
            option.value === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PreferenceSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<Choice<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PreferenceCard({
  icon: Icon,
  title,
  meta,
  children,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {meta ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function PreferencesTab({
  preferences,
  onPreferenceChange,
}: {
  preferences: SettingsPreferences;
  onPreferenceChange: Props['onPreferenceChange'];
}) {
  const { unit, setUnit } = useTempUnit();
  const previewDate = new Date();
  const setDateTime = <K extends keyof DateTimePreferences>(
    key: K,
    value: DateTimePreferences[K],
  ) => {
    onPreferenceChange('dateTime', { ...preferences.dateTime, [key]: value });
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <PreferenceCard
        icon={MonitorCog}
        title="Appearance"
        meta={preferences.theme === 'system' ? 'Auto' : preferences.theme}
      >
        <SegmentedChoice<ThemeChoice>
          value={preferences.theme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'Auto' },
          ]}
          onChange={(v) => onPreferenceChange('theme', v)}
        />
      </PreferenceCard>

      <PreferenceCard icon={Gauge} title="Density" meta={preferences.density}>
        <SegmentedChoice<Density>
          value={preferences.density}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'regular', label: 'Regular' },
            { value: 'comfy', label: 'Comfy' },
          ]}
          onChange={(v) => onPreferenceChange('density', v)}
        />
      </PreferenceCard>

      <PreferenceCard icon={Thermometer} title="Temperature unit" meta={`Current °${unit}`}>
        <SegmentedChoice<TempUnit>
          value={unit}
          options={[
            { value: 'F', label: 'Fahrenheit' },
            { value: 'C', label: 'Celsius' },
          ]}
          onChange={setUnit}
        />
      </PreferenceCard>

      <PreferenceCard
        icon={Clock3}
        title="Time format"
        meta={formatClockTime(previewDate, preferences.dateTime)}
      >
        <SegmentedChoice<TimeFormat>
          value={preferences.dateTime.timeFormat}
          options={TIME_FORMAT_OPTIONS}
          onChange={(v) => setDateTime('timeFormat', v)}
        />
      </PreferenceCard>

      <PreferenceCard
        icon={CalendarDays}
        title="Date format"
        meta={formatClockDate(previewDate, preferences.dateTime)}
      >
        <PreferenceSelect<DateFormat>
          value={preferences.dateTime.dateFormat}
          options={DATE_FORMAT_OPTIONS}
          onChange={(v) => setDateTime('dateFormat', v)}
        />
      </PreferenceCard>

      <PreferenceCard
        icon={Globe2}
        title="Time zone"
        meta={timeZoneLabel(preferences.dateTime.timeZone)}
      >
        <PreferenceSelect<TimeZoneChoice>
          value={preferences.dateTime.timeZone}
          options={TIME_ZONE_OPTIONS}
          onChange={(v) => setDateTime('timeZone', v)}
        />
      </PreferenceCard>

      <PreferenceCard
        icon={Bell}
        title="Alerts"
        meta={preferences.showAlerts ? 'Banner on' : 'Banner off'}
      >
        <div className="flex min-h-9 items-center justify-between gap-3">
          <span className="text-sm text-foreground">Alert banner</span>
          <Switch
            checked={preferences.showAlerts}
            onCheckedChange={(v) => onPreferenceChange('showAlerts', v)}
          />
        </div>
      </PreferenceCard>

      <div className="rounded-xl border border-border bg-card p-4 shadow-card lg:col-span-2">
        <div className="mb-3 flex items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
            <LayoutGrid className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">Overview tiles</div>
            <div className="text-xs tabular-nums text-muted-foreground">
              {preferences.overviewLayout.length} / {ALL_TILES.length} visible
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_TILES.map((tile) => {
            const checked = preferences.overviewLayout.includes(tile.id);
            return (
              <label
                key={tile.id}
                className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => {
                    const cur = preferences.overviewLayout.filter((id) => id !== tile.id);
                    onPreferenceChange('overviewLayout', next === true ? [...cur, tile.id] : cur);
                  }}
                />
                <span className="truncate">{tile.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IntegrationsTab({
  integrations,
  onChange,
}: {
  integrations: Record<IntegrationKey, boolean>;
  onChange: (integrations: Record<IntegrationKey, boolean>) => void;
}) {
  const { data, error, loading } = useServerHealth();
  const total = INTEGRATIONS.length;
  const enabledCount = INTEGRATIONS.reduce((n, def) => n + (integrations[def.key] ? 1 : 0), 0);
  const allOn = enabledCount === total;
  const allOff = enabledCount === 0;
  const setOne = (key: IntegrationKey, value: boolean) =>
    onChange({ ...integrations, [key]: value });
  const setAll = (value: boolean) => {
    const next = { ...integrations };
    for (const def of INTEGRATIONS) next[def.key] = value;
    onChange(next);
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-lg tracking-tight text-foreground">Integrations</h2>
          <span className="text-sm tabular-nums text-muted-foreground">
            {enabledCount} / {total} active
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={allOn} onClick={() => setAll(true)}>
            Enable all
          </Button>
          <Button variant="outline" size="sm" disabled={allOff} onClick={() => setAll(false)}>
            Disable all
          </Button>
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
            ? 'checking server...'
            : !enabled
              ? 'paused - no API calls'
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
                <Switch
                  checked={enabled}
                  aria-label={`Toggle ${def.label}`}
                  onCheckedChange={(v) => setOne(def.key, v)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind={status.kind} title={status.hint}>
                  server: {status.label}
                </StatusBadge>
                <span className="truncate text-xs text-muted-foreground" title={pollLabel}>
                  {pollLabel}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SeverityTab() {
  const thresholds = useThresholds();
  const { unit } = useTempUnit();
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-lg tracking-tight text-foreground">
            Severity thresholds
          </h2>
          <span className="text-sm text-muted-foreground">Temps in °{unit}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => resetThresholds()}>
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </header>
      <div className="grid grid-cols-1 gap-1 rounded-xl border border-border bg-card p-2 shadow-card lg:grid-cols-2">
        {(Object.keys(THRESHOLD_LABELS) as Array<keyof Thresholds>).map((k) => (
          <ThresholdRow key={k} k={k} thresholds={thresholds} unit={unit} />
        ))}
      </div>
    </section>
  );
}

export function SettingsPage({
  integrations,
  preferences,
  tab,
  onTabChange,
  onIntegrationChange,
  onPreferenceChange,
}: Props) {
  const enabledCount = INTEGRATIONS.reduce((n, def) => n + (integrations[def.key] ? 1 : 0), 0);
  const visibleTiles = preferences.overviewLayout.length;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-[var(--page-gap)]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl tracking-tight text-foreground">Settings</h1>
          <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>{visibleTiles} overview tiles</span>
            <span>·</span>
            <span>{enabledCount} integrations active</span>
          </div>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as SettingsTabId)}
        className="gap-4"
      >
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto border-b border-border pb-2"
        >
          <TabsTrigger value="preferences">
            <SlidersHorizontal className="size-4" /> Preferences
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <PlugZap className="size-4" /> Integrations
          </TabsTrigger>
          <TabsTrigger value="severity">
            <Gauge className="size-4" /> Severity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preferences">
          <PreferencesTab preferences={preferences} onPreferenceChange={onPreferenceChange} />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsTab integrations={integrations} onChange={onIntegrationChange} />
        </TabsContent>
        <TabsContent value="severity">
          <SeverityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
