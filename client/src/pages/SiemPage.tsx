import { useMemo, useState } from 'react';

type LogSource = 'nas' | 'network' | 'cameras';
type SourceFilter = 'all' | LogSource;
type Severity = 'info' | 'warn' | 'bad' | 'ok';
type SeverityFilter = 'all' | Severity;
type Range = '1h' | '24h' | '7d' | '30d';

interface LogEntry {
  id: string;
  ts: number;
  severity: Severity;
  source: LogSource;
  component: string;
  message: string;
  detail?: string;
}

const SOURCE_LABEL: Record<LogSource, string> = {
  nas: 'NAS',
  network: 'Network',
  cameras: 'Cameras',
};

// No data source wired up yet — SIEM page renders empty until logs feed in.
const ALL_LOGS: LogEntry[] = [];

const RANGE_MS: Record<Range, number> = {
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function fmtAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export function SiemPage() {
  const [source, setSource] = useState<SourceFilter>('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [range, setRange] = useState<Range>('24h');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rangeFiltered = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[range];
    return ALL_LOGS.filter((e) => e.ts >= cutoff);
  }, [range]);

  const sourceCounts = useMemo(() => {
    let nas = 0, network = 0, cameras = 0;
    for (const e of rangeFiltered) {
      if (e.source === 'nas') nas++;
      else if (e.source === 'network') network++;
      else cameras++;
    }
    return { all: rangeFiltered.length, nas, network, cameras };
  }, [rangeFiltered]);

  const scoped = useMemo(
    () => (source === 'all' ? rangeFiltered : rangeFiltered.filter((e) => e.source === source)),
    [rangeFiltered, source],
  );

  const sevCounts = useMemo(() => {
    let info = 0, warn = 0, bad = 0, ok = 0;
    for (const e of scoped) {
      if (e.severity === 'info') info++;
      else if (e.severity === 'warn') warn++;
      else if (e.severity === 'bad') bad++;
      else if (e.severity === 'ok') ok++;
    }
    return { all: scoped.length, info, warn, bad, ok };
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter((e) => {
      if (severity !== 'all' && e.severity !== severity) return false;
      if (!q) return true;
      return (
        e.message.toLowerCase().includes(q) ||
        e.component.toLowerCase().includes(q) ||
        (e.detail?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [scoped, severity, query]);

  const newest = scoped[0];
  const scopeLabel = source === 'all' ? 'All sources' : SOURCE_LABEL[source];

  return (
    <div className="page">
      <div className="logs-summary">
        <div className="ls-meta">
          <div className="ls-title">
            SIEM
            <span className="ls-count">
              {scopeLabel} · {sevCounts.all} in last {range}
            </span>
          </div>
          <div className="ls-sub">
            All-in-one event timeline from NAS, Network, and Cameras. Filter by source
            to scope the view, by severity to triage, or by time range.
          </div>
        </div>
        <div className="ls-stats">
          <Stat label="Errors" value={sevCounts.bad} kind="bad" />
          <Stat label="Warnings" value={sevCounts.warn} kind="warn" />
          <Stat label="Info" value={sevCounts.info} />
          <Stat label="Newest" value={newest ? fmtAgo(newest.ts) : '—'} mono />
        </div>
      </div>

      <div className="logs-toolbar">
        <div className="lt-chips">
          <SourceChip active={source === 'all'} onClick={() => setSource('all')} accent>
            All <span className="ct">{sourceCounts.all}</span>
          </SourceChip>
          <SourceChip active={source === 'nas'} onClick={() => setSource('nas')}>
            NAS <span className="ct">{sourceCounts.nas}</span>
          </SourceChip>
          <SourceChip active={source === 'network'} onClick={() => setSource('network')}>
            Network <span className="ct">{sourceCounts.network}</span>
          </SourceChip>
          <SourceChip active={source === 'cameras'} onClick={() => setSource('cameras')}>
            Cameras <span className="ct">{sourceCounts.cameras}</span>
          </SourceChip>
        </div>
        <div className="lt-right">
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
            placeholder="Filter messages, components, details…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

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
          <SevChip active={severity === 'ok'} kind="ok" onClick={() => setSeverity('ok')}>
            OK <span className="ct">{sevCounts.ok}</span>
          </SevChip>
        </div>
      </div>

      <div className="logs-table-wrap">
        {filtered.length === 0 ? (
          <div className="logs-empty">No entries match the current filters.</div>
        ) : (
          <ol className="logs-list">
            {filtered.map((e) => {
              const isOpen = expandedId === e.id;
              return (
                <li
                  key={e.id}
                  className={`log-row ${isOpen ? 'is-open' : ''}`}
                  onClick={() => setExpandedId(isOpen ? null : e.id)}
                >
                  <div className="lr-line">
                    <span className="lr-ts" title={new Date(e.ts).toLocaleString()}>
                      {fmtTime(e.ts)}
                    </span>
                    <span className={`status-dot ${e.severity}`} />
                    <span className={`lr-source src-${e.source}`}>{SOURCE_LABEL[e.source]}</span>
                    <span className="lr-comp">{e.component}</span>
                    <span className="lr-msg">{e.message}</span>
                    <span className="lr-ago">{fmtAgo(e.ts)}</span>
                  </div>
                  {isOpen && e.detail ? (
                    <pre className="lr-detail">{e.detail}</pre>
                  ) : null}
                  {isOpen && !e.detail ? (
                    <div className="lr-detail muted">No additional context.</div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
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

function SourceChip({
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
