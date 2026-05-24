import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  SiemStatus,
  SyslogCategory,
  SyslogDeviceKind,
  SyslogEvent,
} from '../types';
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

export function SiemPage() {
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
              if (prev.length && prev[0].id === evt.id) return prev;
              const next = [evt, ...prev];
              if (next.length > MAX_LIVE_BUFFER) next.length = MAX_LIVE_BUFFER;
              return next;
            });
          },
          onStatus: (s) => alive && setStatus(s),
          onError: () => { /* EventSource auto-reconnects */ },
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
      all: rangeFiltered.length, gateway: 0, ap: 0, switch: 0, controller: 0, unknown: 0,
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
    let info = 0, warn = 0, bad = 0;
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
      'firewall', 'client', 'ids', 'vpn', 'admin',
      'update', 'system', 'monitoring', 'security', 'threat',
    ];
    return order.filter((c) => (categoryCounts[c] ?? 0) > 0);
  }, [categoryCounts]);

  return (
    <div className="page">
      <SiemStatusBanner
        status={status}
        setupOpen={setupOpen}
        onToggleSetup={() => setSetupOpen((s) => !s)}
      />

      <div className="logs-summary">
        <div className="ls-meta">
          <div className="ls-title">
            SIEM
            <span className="ls-count">
              {device === 'all' ? 'All devices' : deviceKindLabel(device)}
              {category !== 'all' ? ` · ${categoryLabel(category)}` : ''}
              {' · '}{sevCounts.all} in last {range}
            </span>
          </div>
          <div className="ls-sub">
            Syslog events ingested from your UniFi gateway, access points, switches, and
            controller. Filter by device, category, or severity to triage; click a row to
            inspect parsed fields and the raw message.
          </div>
        </div>
        <div className="ls-stats">
          <Stat label="Errors" value={sevCounts.bad} kind="bad" />
          <Stat label="Warnings" value={sevCounts.warn} kind="warn" />
          <Stat label="Info" value={sevCounts.info} />
          <Stat label="Newest" value={newest ? fmtAgo(newest.receivedAt) : '—'} mono />
        </div>
      </div>

      <div className="logs-toolbar">
        <div className="lt-chips">
          <DeviceChip active={device === 'all'} onClick={() => setDevice('all')} accent>
            All <span className="ct">{deviceCounts.all}</span>
          </DeviceChip>
          {(['gateway', 'ap', 'switch', 'controller', 'unknown'] as SyslogDeviceKind[]).map((k) => (
            (deviceCounts[k] ?? 0) === 0 ? null : (
              <DeviceChip key={k} active={device === k} onClick={() => setDevice(k)}>
                {deviceKindLabel(k)} <span className="ct">{deviceCounts[k]}</span>
              </DeviceChip>
            )
          ))}
        </div>
        <div className="lt-right">
          <button
            type="button"
            className={`lt-chip ${liveTail ? 'is-on ok' : ''}`}
            onClick={() => setLiveTail((v) => !v)}
            title={liveTail ? 'Pause live updates' : 'Resume live updates'}
          >
            <span className={`status-dot ${liveTail ? 'ok' : 'warn'}`} />
            {liveTail ? 'Live' : 'Paused'}
          </button>
          <div className="lt-range">
            {(['1h', '24h', '7d', '30d'] as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                className={r === range ? 'is-on' : ''}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="lt-search"
            placeholder="Filter messages, hosts, IPs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {visibleCategories.length > 0 ? (
        <div className="logs-toolbar logs-toolbar-sub">
          <div className="lt-chips">
            <CategoryChip active={category === 'all'} onClick={() => setCategory('all')}>
              All <span className="ct">{categoryCounts.all ?? 0}</span>
            </CategoryChip>
            {visibleCategories.map((c) => (
              <CategoryChip key={c} active={category === c} onClick={() => setCategory(c)}>
                {categoryLabel(c)} <span className="ct">{categoryCounts[c]}</span>
              </CategoryChip>
            ))}
          </div>
        </div>
      ) : null}

      <div className="logs-toolbar logs-toolbar-sub">
        <div className="lt-chips">
          <SevChip active={severity === 'all'} onClick={() => setSeverity('all')}>
            All <span className="ct">{sevCounts.all}</span>
          </SevChip>
          <SevChip active={severity === 'bad'} kind="bad" onClick={() => setSeverity('bad')}>
            Errors <span className="ct">{sevCounts.bad}</span>
          </SevChip>
          <SevChip active={severity === 'warn'} kind="warn" onClick={() => setSeverity('warn')}>
            Warnings <span className="ct">{sevCounts.warn}</span>
          </SevChip>
          <SevChip active={severity === 'info'} kind="info" onClick={() => setSeverity('info')}>
            Info <span className="ct">{sevCounts.info}</span>
          </SevChip>
        </div>
      </div>

      <div className="logs-table-wrap">
        {loading ? (
          <div className="logs-empty">Loading events…</div>
        ) : loadError ? (
          <div className="logs-empty">Failed to load: {loadError}</div>
        ) : filtered.length === 0 ? (
          <div className="logs-empty">
            {events.length === 0
              ? 'No syslog events yet. Configure your UniFi controller to send remote syslog to this server.'
              : 'No entries match the current filters.'}
          </div>
        ) : (
          <ol className="logs-list">
            {filtered.map((e) => {
              const isOpen = expandedId === e.id;
              const ui = severityToUi(e.severity);
              return (
                <li
                  key={e.id}
                  className={`log-row ${isOpen ? 'is-open' : ''}`}
                  onClick={() => setExpandedId(isOpen ? null : e.id)}
                >
                  <div className="lr-line">
                    <span className="lr-ts" title={new Date(e.receivedAt).toLocaleString()}>
                      {fmtTime(e.receivedAt)}
                    </span>
                    <span className={`status-dot ${ui}`} />
                    <span className={`lr-source src-${e.deviceKind}`}>
                      {deviceKindLabel(e.deviceKind)}
                    </span>
                    <span className="lr-comp">{componentLabel(e)}</span>
                    <span className="lr-msg">{summary(e)}</span>
                    <span className="lr-ago">{fmtAgo(e.receivedAt)}</span>
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

  return (
    <div className="siem-detail">
      <dl className="siem-facts">
        {facts.map(([k, v]) => (
          <div key={k} className="siem-fact">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {evt.extra && Object.keys(evt.extra).length > 0 ? (
        <>
          <div className="siem-detail-h">CEF fields</div>
          <dl className="siem-facts">
            {Object.entries(evt.extra).map(([k, v]) => (
              <div key={k} className="siem-fact">
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <div className="siem-detail-h">Raw</div>
      <pre className="lr-detail">{evt.raw}</pre>
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
  if (!status) {
    return (
      <div className="siem-status">
        <span className="status-dot info" />
        <span className="ss-text">Connecting to SIEM…</span>
      </div>
    );
  }
  if (!status.enabled) {
    return (
      <div className="siem-status warn">
        <span className="status-dot warn" />
        <span className="ss-text">
          SIEM is disabled. Set <code>SIEM_ENABLED=true</code> in <code>.env</code> and restart the
          server to start receiving UniFi syslog.
        </span>
      </div>
    );
  }
  const addr = `${status.serverAddress}:${status.port}`;
  const isListening = status.listening;
  const dotKind: UiSeverity = isListening ? 'info' : 'bad';
  const bindMsg = status.bindError;
  const lastAgo = status.lastEventAt ? fmtAgo(status.lastEventAt) : 'never';
  return (
    <div className={`siem-status ${isListening ? '' : 'bad'}`}>
      <span className={`status-dot ${dotKind === 'info' ? 'ok' : 'bad'}`} />
      <div className="ss-text">
        {isListening ? (
          <>
            <strong>Listening on UDP {addr}</strong>
            <span className="ss-meta">
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
            <strong>SIEM not listening</strong>
            {bindMsg ? <span className="ss-meta"> · {bindMsg}</span> : null}
          </>
        )}
      </div>
      <button type="button" className="ss-toggle" onClick={onToggleSetup}>
        {setupOpen ? 'Hide setup' : 'Show setup'}
      </button>
      {setupOpen ? (
        <div className="siem-setup">
          <div className="siem-setup-h">Configure UniFi to send syslog here</div>
          <ol>
            <li>Open your UniFi Network Application.</li>
            <li>Go to <strong>Settings → System → Remote Logging</strong>.</li>
            <li>Enable <em>Remote Syslog Server</em>.</li>
            <li>
              Set the address to <code className="copy">{addr}</code>
              {' '}(protocol: UDP).
            </li>
            <li>Save. Devices will start streaming events within a minute.</li>
          </ol>
          {bindMsg ? (
            <div className="siem-setup-warn">
              Server reports: {bindMsg}. If port 514 won't bind, set
              {' '}<code>SIEM_PORT=5514</code> in <code>.env</code> and use that in UniFi instead.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  kind,
  mono,
}: {
  label: string;
  value: number | string;
  kind?: 'bad' | 'warn';
  mono?: boolean;
}) {
  return (
    <div className="ls-stat">
      <div className="ls-stat-lbl">{label}</div>
      <div className={`ls-stat-v ${kind ?? ''} ${mono ? 'mono' : ''}`}>{value}</div>
    </div>
  );
}

function DeviceChip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`lt-chip lt-chip-lg ${active ? (accent ? 'is-on' : 'is-on-neutral') : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`lt-chip ${active ? 'is-on' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SevChip({
  active,
  kind,
  onClick,
  children,
}: {
  active: boolean;
  kind?: 'bad' | 'warn' | 'info' | 'ok';
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`lt-chip ${active ? 'is-on' : ''} ${kind ?? ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
