import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';

import type { SiemStatus, SyslogCategory, SyslogDeviceKind, SyslogEvent } from '../types';
import { fetchLogs, subscribeSiem } from '../lib/siem';
import {
  categoryLabel,
  componentLabel,
  deviceKindLabel,
  fmtBytes,
  severityName,
  severityToUi,
  summary,
} from '../lib/syslog';
import { Segmented } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCapabilityPresentation } from '@/lib/presentation';

type UiSeverity = 'info' | 'warn' | 'bad';
type SeverityFilter = 'all' | UiSeverity;
type DeviceFilter = 'all' | SyslogDeviceKind;
type CategoryFilter = 'all' | SyslogCategory;
type Range = '1h' | '24h' | '7d' | '30d';

const RANGE_MS: Record<Range, number> = {
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

const MAX_LIVE_BUFFER = 5000;
const BACKFILL_LIMIT = 1000;

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function fmtAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

type ChipKind = 'brand' | 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

const CHIP_ACTIVE: Record<ChipKind, string> = {
  brand:
    'border-[color-mix(in_oklab,var(--accent)_40%,transparent)] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-brand',
  neutral: 'border-border bg-muted text-foreground',
  ok: 'border-[color-mix(in_oklab,var(--ok)_35%,transparent)] bg-[color-mix(in_oklab,var(--ok)_12%,transparent)] text-ok',
  warn: 'border-[color-mix(in_oklab,var(--warn)_35%,transparent)] bg-[color-mix(in_oklab,var(--warn)_12%,transparent)] text-warn',
  bad: 'border-[color-mix(in_oklab,var(--bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--bad)_12%,transparent)] text-bad',
  info: 'border-[color-mix(in_oklab,var(--info)_35%,transparent)] bg-[color-mix(in_oklab,var(--info)_12%,transparent)] text-info',
};

function FilterChip({
  active,
  kind = 'neutral',
  onClick,
  count,
  children,
}: {
  active: boolean;
  kind?: ChipKind;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? CHIP_ACTIVE[kind]
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
      {count != null ? <span className="tabular-nums opacity-70">{count}</span> : null}
    </button>
  );
}

export function SiemPage() {
  const logs = useCapabilityPresentation('logs');
  const [events, setEvents] = useState<SyslogEvent[]>([]);
  const [status, setStatus] = useState<SiemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [range, setRange] = useState<Range>('24h');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [liveTail, setLiveTail] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  // Ref lifts live state into the EventSource callback without re-subscribing.
  const liveTailRef = useRef(liveTail);
  liveTailRef.current = liveTail;
  const [, forceTick] = useState(0);

  useEffect(() => {
    let alive = true;
    let sub: { dispose(): void } | null = null;
    (async () => {
      try {
        const initial = await fetchLogs({ limit: BACKFILL_LIMIT });
        if (!alive) return;
        setEvents(initial);
        setLoading(false);
        const lastId = initial[0]?.id;
        sub = subscribeSiem({
          lastEventId: lastId,
          onEvent: (evt) => {
            if (!alive) return;
            if (!liveTailRef.current) return;
            setEvents((prev) => {
              // Robust dedup: backfill + replay + live-tail can overlap on
              // reconnect; only the head check would miss duplicates buried
              // by a concurrent re-fetch. Use a Set over the existing ids.
              for (let i = 0; i < prev.length; i++) {
                if (prev[i].id === evt.id) return prev;
              }
              const next = [evt, ...prev];
              if (next.length > MAX_LIVE_BUFFER) next.length = MAX_LIVE_BUFFER;
              return next;
            });
          },
          onReplayTruncated: async ({ replayFromId, replayThroughId }) => {
            // Server's replay was capped at 1000 events; fetch the gap so
            // the in-memory buffer doesn't have a silent hole between the
            // backfill and the live tail.
            try {
              const gap = await fetchLogs({
                afterId: replayFromId,
                limit: 5000,
                order: 'desc',
              });
              if (!alive || gap.length === 0) return;
              setEvents((prev) => {
                const seen = new Set(prev.map((e) => e.id));
                const merged = [...prev];
                for (const e of gap) {
                  if (e.id > replayThroughId) continue; // live tail handles these
                  if (seen.has(e.id)) continue;
                  merged.push(e);
                  seen.add(e.id);
                }
                merged.sort((a, b) => b.id - a.id);
                if (merged.length > MAX_LIVE_BUFFER) merged.length = MAX_LIVE_BUFFER;
                return merged;
              });
            } catch {
              /* leave the gap rather than crash */
            }
          },
          onStatus: (s) => alive && setStatus(s),
          onError: () => {
            /* EventSource auto-reconnects */
          },
        });
      } catch (err) {
        if (!alive) return;
        setLoadError((err as Error).message);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
      sub?.dispose();
    };
  }, []);

  // Tick so the "ago" labels stay current.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const rangeFiltered = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[range];
    return events.filter((e) => e.receivedAt >= cutoff);
  }, [events, range]);

  const deviceCounts = useMemo(() => {
    const c: Record<DeviceFilter, number> = {
      all: rangeFiltered.length,
      gateway: 0,
      ap: 0,
      switch: 0,
      controller: 0,
      unknown: 0,
    };
    for (const e of rangeFiltered) c[e.deviceKind] = (c[e.deviceKind] ?? 0) + 1;
    return c;
  }, [rangeFiltered]);

  const scoped = useMemo(
    () => (device === 'all' ? rangeFiltered : rangeFiltered.filter((e) => e.deviceKind === device)),
    [rangeFiltered, device],
  );

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { all: scoped.length };
    for (const e of scoped) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  }, [scoped]);

  const scopedByCategory = useMemo(
    () => (category === 'all' ? scoped : scoped.filter((e) => e.category === category)),
    [scoped, category],
  );

  const sevCounts = useMemo(() => {
    let info = 0,
      warn = 0,
      bad = 0;
    for (const e of scopedByCategory) {
      const ui = severityToUi(e.severity);
      if (ui === 'info') info++;
      else if (ui === 'warn') warn++;
      else if (ui === 'bad') bad++;
    }
    return { all: scopedByCategory.length, info, warn, bad };
  }, [scopedByCategory]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scopedByCategory.filter((e) => {
      if (severity !== 'all' && severityToUi(e.severity) !== severity) return false;
      if (!q) return true;
      return (
        e.message.toLowerCase().includes(q) ||
        e.raw.toLowerCase().includes(q) ||
        (e.hostname?.toLowerCase().includes(q) ?? false) ||
        e.sourceIp.includes(q)
      );
    });
  }, [scopedByCategory, severity, query]);

  const newest = scopedByCategory[0];

  const visibleCategories = useMemo(() => {
    const order: SyslogCategory[] = [
      'firewall',
      'client',
      'ids',
      'vpn',
      'admin',
      'update',
      'system',
      'monitoring',
      'security',
      'threat',
    ];
    return order.filter((c) => (categoryCounts[c] ?? 0) > 0);
  }, [categoryCounts]);

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <SiemStatusBanner
        status={status}
        setupOpen={setupOpen}
        onToggleSetup={() => setSetupOpen((s) => !s)}
      />

      {/* Summary + stats */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-card">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg tracking-tight text-foreground">{logs.label}</h2>
          <div className="text-xs text-muted-foreground">
            {device === 'all' ? 'All devices' : deviceKindLabel(device)}
            {category !== 'all' ? ` · ${categoryLabel(category)}` : ''}
            {' · '}
            {sevCounts.all} in last {range}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <SiemStat label="Errors" value={sevCounts.bad} tone="bad" />
          <SiemStat label="Warnings" value={sevCounts.warn} tone="warn" />
          <SiemStat label="Info" value={sevCounts.info} />
          <SiemStat label="Newest" value={newest ? fmtAgo(newest.receivedAt) : '—'} mono />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip
              active={device === 'all'}
              kind="brand"
              count={deviceCounts.all}
              onClick={() => setDevice('all')}
            >
              All
            </FilterChip>
            {(['gateway', 'ap', 'switch', 'controller', 'unknown'] as SyslogDeviceKind[]).map(
              (k) =>
                (deviceCounts[k] ?? 0) === 0 ? null : (
                  <FilterChip
                    key={k}
                    active={device === k}
                    count={deviceCounts[k]}
                    onClick={() => setDevice(k)}
                  >
                    {deviceKindLabel(k)}
                  </FilterChip>
                ),
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLiveTail((v) => !v)}
              title={liveTail ? 'Pause live updates' : 'Resume live updates'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                liveTail
                  ? CHIP_ACTIVE.ok
                  : 'border-border bg-card text-muted-foreground hover:bg-muted',
              )}
            >
              <span
                className={cn('size-1.5 rounded-full', liveTail ? 'bg-ok icon-pulse' : 'bg-warn')}
              />
              {liveTail ? 'Live' : 'Paused'}
            </button>
            <Segmented
              value={range}
              onChange={(v) => setRange(v as Range)}
              options={(['1h', '24h', '7d', '30d'] as Range[]).map((r) => ({ value: r, label: r }))}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Filter messages, hosts, IPs…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 w-56 pl-8"
              />
            </div>
          </div>
        </div>

        {visibleCategories.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
            <FilterChip
              active={category === 'all'}
              count={categoryCounts.all ?? 0}
              onClick={() => setCategory('all')}
            >
              All
            </FilterChip>
            {visibleCategories.map((c) => (
              <FilterChip
                key={c}
                active={category === c}
                count={categoryCounts[c]}
                onClick={() => setCategory(c)}
              >
                {categoryLabel(c)}
              </FilterChip>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
          <FilterChip
            active={severity === 'all'}
            count={sevCounts.all}
            onClick={() => setSeverity('all')}
          >
            All
          </FilterChip>
          <FilterChip
            active={severity === 'bad'}
            kind="bad"
            count={sevCounts.bad}
            onClick={() => setSeverity('bad')}
          >
            Errors
          </FilterChip>
          <FilterChip
            active={severity === 'warn'}
            kind="warn"
            count={sevCounts.warn}
            onClick={() => setSeverity('warn')}
          >
            Warnings
          </FilterChip>
          <FilterChip
            active={severity === 'info'}
            kind="info"
            count={sevCounts.info}
            onClick={() => setSeverity('info')}
          >
            Info
          </FilterChip>
        </div>
      </div>

      {/* Log list */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading events…</div>
        ) : loadError ? (
          <div className="p-10 text-center text-sm text-bad">Failed to load: {loadError}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {events.length === 0
              ? 'No syslog events yet. Configure your network devices to send remote syslog to this server.'
              : 'No entries match the current filters.'}
          </div>
        ) : (
          <ol className="flex flex-col">
            {filtered.map((e) => {
              const isOpen = expandedId === e.id;
              const ui = severityToUi(e.severity);
              return (
                <li
                  key={e.id}
                  className={cn(
                    'cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50',
                    isOpen && 'bg-muted/50',
                  )}
                  onClick={() => setExpandedId(isOpen ? null : e.id)}
                >
                  <div className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span
                      className="w-20 shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
                      title={new Date(e.receivedAt).toLocaleString()}
                    >
                      {fmtTime(e.receivedAt)}
                    </span>
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        ui === 'bad' ? 'bg-bad' : ui === 'warn' ? 'bg-warn' : 'bg-info',
                      )}
                    />
                    <span className="w-24 shrink-0 truncate text-xs font-medium text-foreground">
                      {deviceKindLabel(e.deviceKind)}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {componentLabel(e)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                      {summary(e)}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtAgo(e.receivedAt)}
                    </span>
                  </div>
                  {isOpen ? <SiemDetail evt={e} /> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function SiemDetail({ evt }: { evt: SyslogEvent }) {
  const facts: [string, string][] = [
    ['Source IP', evt.sourceIp],
    ['Hostname', evt.hostname ?? '—'],
    ['Severity', `${evt.severity} (${severityName(evt.severity)})`],
    ['Facility', evt.facility != null ? String(evt.facility) : '—'],
    ['Tag', evt.tag ?? '—'],
    ['Category', categoryLabel(evt.category)],
    ['Format', evt.format.toUpperCase()],
    ['Received', new Date(evt.receivedAt).toLocaleString()],
  ];
  if (evt.logTime) facts.push(['Log time', new Date(evt.logTime).toLocaleString()]);

  const Facts = ({ entries }: { entries: [string, string][] }) => (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{k}</dt>
          <dd className="text-sm break-words text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
  const heading = (t: string) => (
    <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {t}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-4 py-3">
      <Facts entries={facts} />
      {evt.extra && Object.keys(evt.extra).length > 0 ? (
        <>
          {heading('CEF fields')}
          <Facts
            entries={Object.entries(evt.extra).map(([k, v]) => [k, String(v)] as [string, string])}
          />
        </>
      ) : null}
      {heading('Raw')}
      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
        {evt.raw}
      </pre>
    </div>
  );
}

function SiemStatusBanner({
  status,
  setupOpen,
  onToggleSetup,
}: {
  status: SiemStatus | null;
  setupOpen: boolean;
  onToggleSetup: () => void;
}) {
  const shell =
    'flex flex-wrap items-center gap-3 rounded-xl border border-border border-l-4 bg-card p-4 shadow-card';
  const code = 'rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground';

  if (!status) {
    return (
      <div className={cn(shell, 'border-l-info')}>
        <span className="size-2 shrink-0 rounded-full bg-info" />
        <span className="text-sm text-muted-foreground">Connecting to SIEM…</span>
      </div>
    );
  }
  if (!status.enabled) {
    return (
      <div className={cn(shell, 'border-l-warn')}>
        <span className="size-2 shrink-0 rounded-full bg-warn" />
        <span className="text-sm text-muted-foreground">
          SIEM is disabled. Set <code className={code}>SIEM_ENABLED=true</code> in{' '}
          <code className={code}>.env</code> and restart the server to start receiving syslog.
        </span>
      </div>
    );
  }
  const addr = `${status.serverAddress}:${status.port}`;
  const isListening = status.listening;
  const bindMsg = status.bindError;
  const lastAgo = status.lastEventAt ? fmtAgo(status.lastEventAt) : 'never';
  return (
    <div className={cn(shell, isListening ? 'border-l-ok' : 'border-l-bad')}>
      <span className={cn('size-2 shrink-0 rounded-full', isListening ? 'bg-ok' : 'bg-bad')} />
      <div className="min-w-0 flex-1 text-sm">
        {isListening ? (
          <>
            <span className="font-semibold text-foreground">Listening on UDP {addr}</span>
            <span className="text-muted-foreground">
              {' · '}
              {status.eventsTotal.toLocaleString()} stored
              {' · '}
              {status.eventsLastHour.toLocaleString()} in last hour
              {' · '}
              {fmtBytes(status.bytesReceived)} received
              {' · '}
              last event {lastAgo}
            </span>
          </>
        ) : (
          <>
            <span className="font-semibold text-foreground">SIEM not listening</span>
            {bindMsg ? <span className="text-muted-foreground"> · {bindMsg}</span> : null}
          </>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={onToggleSetup}>
        {setupOpen ? 'Hide setup' : 'Show setup'}
      </Button>
      {setupOpen ? (
        <div className="basis-full border-t border-border pt-3 text-sm text-muted-foreground">
          <div className="mb-2 font-semibold text-foreground">
            Configure devices to send syslog here
          </div>
          <ol className="ml-4 list-decimal space-y-1">
            <li>Open your device or controller logging settings.</li>
            <li>
              Go to <strong className="text-foreground">Settings → System → Remote Logging</strong>.
            </li>
            <li>
              Enable <em>Remote Syslog Server</em>.
            </li>
            <li>
              Set the address to <code className={code}>{addr}</code> (protocol: UDP).
            </li>
            <li>Save. Devices will start streaming events within a minute.</li>
          </ol>
          {bindMsg ? (
            <div className="mt-2 text-warn">
              Server reports: {bindMsg}. If port 514 won't bind, set{' '}
              <code className={code}>SIEM_PORT=5514</code> in <code className={code}>.env</code> and
              use that in your device or controller instead.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SiemStat({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: number | string;
  tone?: 'bad' | 'warn';
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <span
        className={cn(
          'font-display text-xl font-semibold tabular-nums',
          tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-foreground',
          mono && 'font-mono text-base',
        )}
      >
        {value}
      </span>
    </div>
  );
}
