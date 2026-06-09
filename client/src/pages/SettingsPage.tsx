import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Clock3,
  Database,
  Gauge,
  Globe2,
  KeyRound,
  Minus,
  MonitorCog,
  PlugZap,
  Plus,
  RotateCcw,
  Rows3,
  SlidersHorizontal,
  TestTube2,
  Thermometer,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { DEFAULT_SITE_NAME, setSiteName, useSiteNameRaw } from '@/lib/site-name';
import {
  getConfig,
  getDbConfig,
  putSelection,
  saveDbConfig,
  testDbConnection,
  testIntegration,
  useCapabilities,
  type Capability,
  type RedactedCapabilityConfig,
  type RedactedConfig,
} from '@/lib/setup';
import { ConfigFieldsForm } from './onboarding/steps/ConfigFieldsForm';
import { DatabaseStep } from './onboarding/steps/DatabaseStep';
import {
  dbBodyFromDraft,
  dbDirty,
  dbDraftFromView,
  EMPTY_DB_DRAFT,
  type DbDraft,
  type DbStepStatus,
} from './onboarding/db-state';
import { INTEGRATIONS, type HealthInfo, type HealthResponse } from '../lib/integrations';
import type { IntegrationKey } from '../lib/telemetry';
import { convertTemp, fToC, useTempUnit, type TempUnit } from '../lib/units';
import { LIST_ROWS_OPTIONS, setListRows, useListRows } from '../lib/list-rows';
import {
  REFRESH_RATE_OPTIONS,
  refreshRateDescription,
  setRefreshRate,
  useRefreshRate,
  type RefreshRate,
} from '../lib/refresh-rate';
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
import { toast } from 'sonner';

type ThemeChoice = 'light' | 'dark' | 'system';
type Density = 'compact' | 'regular' | 'comfy';
export type SettingsTabId = 'preferences' | 'integrations' | 'setup' | 'severity';

export interface SettingsPreferences {
  theme: ThemeChoice;
  density: Density;
  showAlerts: boolean;
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
  const listRows = useListRows();
  const refreshRate = useRefreshRate();
  const siteName = useSiteNameRaw();
  const previewDate = new Date();
  const setDateTime = <K extends keyof DateTimePreferences>(
    key: K,
    value: DateTimePreferences[K],
  ) => {
    onPreferenceChange('dateTime', { ...preferences.dateTime, [key]: value });
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <PreferenceCard icon={Globe2} title="Site name" meta={siteName.trim() || DEFAULT_SITE_NAME}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="site-name">Name</Label>
          <Input
            id="site-name"
            value={siteName}
            placeholder={DEFAULT_SITE_NAME}
            onChange={(e) => setSiteName(e.target.value)}
            maxLength={120}
          />
        </div>
      </PreferenceCard>

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

      <PreferenceCard icon={Zap} title="Refresh rate" meta={refreshRateDescription(refreshRate)}>
        <SegmentedChoice<RefreshRate>
          value={refreshRate}
          options={REFRESH_RATE_OPTIONS}
          onChange={setRefreshRate}
        />
      </PreferenceCard>

      <PreferenceCard
        icon={Rows3}
        title="List rows"
        meta={listRows === 0 ? 'Show all rows' : `Up to ${listRows} rows per card`}
      >
        <PreferenceSelect<string>
          value={String(listRows)}
          options={LIST_ROWS_OPTIONS.map((n) => ({
            value: String(n),
            label: n === 0 ? 'Show all' : `${n} rows`,
          }))}
          onChange={(v) => setListRows(Number(v))}
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

type SetupDrafts = Record<string, RedactedCapabilityConfig>;

function firstAvailableProviderId(capability: Capability): string {
  return (
    capability.providers.find((provider) => provider.status === 'available') ??
    capability.providers[0]
  )?.id;
}

function buildSetupDrafts(capabilities: Capability[], config: RedactedConfig | null): SetupDrafts {
  const drafts: SetupDrafts = {};
  for (const capability of capabilities) {
    const stored = config?.capabilities[capability.id];
    const vendor = stored?.vendor ?? firstAvailableProviderId(capability);
    const provider = capability.providers.find((p) => p.id === vendor);
    const values: Record<string, unknown> = {};
    for (const field of provider?.configSchema ?? []) {
      if (field.secret && stored?.secrets[field.name]) values[field.name] = '';
      else if (stored?.config[field.name] !== undefined)
        values[field.name] = stored.config[field.name];
      else if (field.default !== undefined) values[field.name] = field.default;
      else values[field.name] = field.type === 'boolean' ? false : '';
    }
    drafts[capability.id] = {
      enabled: stored?.enabled ?? false,
      vendor,
      config: values,
      secrets: stored?.secrets ?? {},
    };
  }
  return drafts;
}

function configForSave(
  capability: Capability,
  draft: RedactedCapabilityConfig,
): Record<string, unknown> {
  const provider = capability.providers.find((p) => p.id === draft.vendor);
  const secretFields = new Set(
    (provider?.configSchema ?? []).filter((f) => f.secret).map((f) => f.name),
  );
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft.config)) {
    if (secretFields.has(key) && draft.secrets[key] && value === '') continue;
    out[key] = value;
  }
  return out;
}

const DB_LABEL: Record<DbDraft['driver'], string> = {
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
};

function DatabaseSettings() {
  const [saved, setSaved] = useState<DbDraft | null>(null);
  const [draft, setDraft] = useState<DbDraft>(EMPTY_DB_DRAFT);
  const [status, setStatus] = useState<DbStepStatus>({
    busy: false,
    message: 'Loading current backend…',
    restartRequired: false,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const view = await getDbConfig();
        if (cancelled) return;
        const next = dbDraftFromView(view);
        setSaved(next);
        setDraft(next);
        setStatus({
          busy: false,
          message: `Current backend: ${DB_LABEL[next.driver]}.`,
          restartRequired: false,
        });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = saved ? dbDirty(draft, saved) : false;
  const driverChanged = !!saved && draft.driver !== saved.driver;

  const onChange = (next: DbDraft) => {
    setDraft(next);
    setConfirmSwitch(false); // editing supersedes a pending switch confirmation
  };

  const test = async () => {
    setStatus({ busy: true, message: 'Testing database connection…', restartRequired: false });
    try {
      const result = await testDbConnection(dbBodyFromDraft(draft));
      setStatus({
        busy: false,
        message: result.ok
          ? 'Connection test passed.'
          : `Connection failed: ${result.error ?? 'unknown error'}`,
        restartRequired: false,
      });
    } catch (err) {
      setStatus({
        busy: false,
        message: err instanceof Error ? err.message : String(err),
        restartRequired: false,
      });
    }
  };

  const persist = async () => {
    setConfirmSwitch(false);
    setStatus({ busy: true, message: 'Saving database settings…', restartRequired: false });
    try {
      await saveDbConfig(dbBodyFromDraft(draft));
      const view = await getDbConfig();
      const next = dbDraftFromView(view);
      setSaved(next);
      setDraft(next);
      setStatus({
        busy: false,
        message: `Saved. Current backend: ${DB_LABEL[next.driver]}.`,
        restartRequired: true,
      });
      toast.success('Database settings saved — restart the server to apply');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ busy: false, message, restartRequired: false });
      toast.error(message);
    }
  };

  const onSave = () => {
    if (driverChanged) {
      setConfirmSwitch(true);
      return;
    }
    void persist();
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
          <Database className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Database backend</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Where the dashboard stores its state and SIEM data. Switching points the app at a fresh
            database and takes effect after a server restart.
          </p>
        </div>
      </div>

      {loadError ? (
        <div className="mb-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-foreground">
          {loadError}
        </div>
      ) : null}

      <DatabaseStep
        draft={draft}
        status={status}
        dirty={dirty}
        onChange={onChange}
        onTest={test}
        onSave={onSave}
      />

      {confirmSwitch ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-warn/50 bg-warn/10 p-3 text-sm text-foreground">
          <div>
            <b className="font-semibold">Switch to {DB_LABEL[draft.driver]}?</b> Existing data is{' '}
            <b>not migrated</b> — the new backend starts empty.
            {saved ? (
              <>
                {' '}
                Your current {DB_LABEL[saved.driver]} data stays on disk but won&apos;t be shown
                until you switch back.
              </>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmSwitch(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void persist()}>
              Switch &amp; save
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SetupTab() {
  const { capabilities, loading, error } = useCapabilities();
  const [config, setConfig] = useState<RedactedConfig | null>(null);
  const [drafts, setDrafts] = useState<SetupDrafts>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { kind: 'ok' | 'bad' | 'info'; label: string; message: string }>
  >({});
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getConfig();
        if (cancelled) return;
        setConfig(next);
        setConfigError(null);
      } catch (err) {
        if (cancelled) return;
        setConfigError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (capabilities.length) setDrafts(buildSetupDrafts(capabilities, config));
  }, [capabilities, config]);

  const updateDraft = (
    capabilityId: string,
    update: (draft: RedactedCapabilityConfig) => RedactedCapabilityConfig,
  ) => {
    setDrafts((prev) => ({ ...prev, [capabilityId]: update(prev[capabilityId]) }));
  };

  const save = async (capability: Capability) => {
    const draft = drafts[capability.id];
    if (!draft) return;
    setSaving(capability.id);
    try {
      await putSelection({
        capability: capability.id,
        vendor: draft.vendor,
        enabled: draft.enabled,
        config: configForSave(capability, draft),
      });
      const next = await getConfig();
      setConfig(next);
      setEditing(null);
      toast.success(`${capability.label} setup saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  const test = async (capability: Capability) => {
    const draft = drafts[capability.id];
    if (!draft) return;
    setTesting(capability.id);
    try {
      const result = await testIntegration({
        capability: capability.id,
        config: configForSave(capability, draft),
      });
      setTestResults((prev) => ({
        ...prev,
        [capability.id]: result.untestable
          ? {
              kind: 'info',
              label: 'untestable',
              message: result.error ?? 'This capability has no automatic connection test.',
            }
          : result.ok
            ? { kind: 'ok', label: 'passed', message: 'Connection test passed.' }
            : {
                kind: 'bad',
                label: 'failed',
                message: result.error ?? 'Connection test failed.',
              },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [capability.id]: {
          kind: 'bad',
          label: 'failed',
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg tracking-tight text-foreground">Setup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved selections are stored server-side and applied to live telemetry immediately.
          </p>
        </div>
      </header>

      {error || configError ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3.5 py-2.5 text-sm text-foreground">
          {error ?? configError}
        </div>
      ) : null}

      {loading ? <div className="text-sm text-muted-foreground">Loading setup...</div> : null}

      <DatabaseSettings />

      <div className="grid grid-cols-1 gap-3">
        {capabilities.map((capability) => {
          const draft = drafts[capability.id];
          const provider = draft
            ? capability.providers.find((candidate) => candidate.id === draft.vendor)
            : null;
          const isEditing = editing === capability.id;
          const testResult = testResults[capability.id];
          const configured = !!config?.capabilities[capability.id];
          if (!draft) return null;
          return (
            <section
              key={capability.id}
              className="rounded-xl border border-border bg-card p-4 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-foreground">{capability.label}</h3>
                    <StatusBadge kind={configured ? 'ok' : 'info'}>
                      {configured ? 'configured' : 'not configured'}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {provider?.label ?? 'No available provider'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={draft.enabled}
                    aria-label={`Enable ${capability.label}`}
                    onCheckedChange={(enabled) =>
                      updateDraft(capability.id, (cur) => ({ ...cur, enabled }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(isEditing ? null : capability.id)}
                  >
                    Configure
                  </Button>
                </div>
              </div>

              {isEditing ? (
                <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`setup-provider-${capability.id}`}>Provider</Label>
                      <Select
                        value={draft.vendor}
                        onValueChange={(vendor) =>
                          updateDraft(capability.id, (cur) => ({
                            ...buildSetupDrafts([capability], {
                              capabilities: {
                                [capability.id]: {
                                  ...cur,
                                  vendor,
                                  config: {},
                                  secrets: cur.secrets,
                                },
                              },
                              onboarding: config?.onboarding ?? { complete: true },
                            })[capability.id],
                            enabled: cur.enabled,
                          }))
                        }
                      >
                        <SelectTrigger id={`setup-provider-${capability.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {capability.providers.map((candidate) => (
                            <SelectItem
                              key={candidate.id}
                              value={candidate.id}
                              disabled={candidate.status !== 'available'}
                            >
                              {candidate.label}
                              {candidate.status === 'planned' ? ' (coming soon)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <ConfigFieldsForm
                    fields={provider?.configSchema ?? []}
                    values={draft.config}
                    secrets={draft.secrets}
                    idPrefix={`settings-setup-${capability.id}`}
                    onChange={(field, value) =>
                      updateDraft(capability.id, (cur) => ({
                        ...cur,
                        config: { ...cur.config, [field]: value },
                      }))
                    }
                  />

                  {testResult ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                      <StatusBadge kind={testResult.kind}>{testResult.label}</StatusBadge>
                      <span className="text-muted-foreground">{testResult.message}</span>
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={testing === capability.id || saving === capability.id}
                      onClick={() => test(capability)}
                    >
                      <TestTube2 className="size-4" />
                      {testing === capability.id ? 'Testing...' : 'Test'}
                    </Button>
                    <Button
                      type="button"
                      disabled={saving === capability.id || testing === capability.id}
                      onClick={() => save(capability)}
                    >
                      {saving === capability.id ? 'Saving...' : 'Save setup'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-[var(--page-gap)]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl tracking-tight text-foreground">Settings</h1>
          <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
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
          <TabsTrigger value="setup">
            <KeyRound className="size-4" /> Setup
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
        <TabsContent value="setup">
          <SetupTab />
        </TabsContent>
        <TabsContent value="severity">
          <SeverityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
