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

const m = (ms: number) => Date.now() - ms;

const NAS_LOGS: LogEntry[] = [
  { id: 'n1', ts: m(60_000), severity: 'info', source: 'nas', component: 'zfs.tank', message: 'Scrub completed: 0 errors, 4.21 TB scanned in 2h 18m.', detail: 'pool=tank repaired=0 read=0 write=0 cksum=0' },
  { id: 'n2', ts: m(5 * 60_000), severity: 'warn', source: 'nas', component: 'smart.sda', message: 'Reallocated_Sector_Ct increased to 12 (was 4).', detail: 'disk=WDC-WD80EFAX-68LHPN0 serial=VAGZNXXX' },
  { id: 'n3', ts: m(18 * 60_000), severity: 'info', source: 'nas', component: 'snapshot', message: 'Auto-snapshot created: tank/data@2026-05-18-0930', detail: 'retain=14 size=482MB' },
  { id: 'n4', ts: m(42 * 60_000), severity: 'ok', source: 'nas', component: 'share.media', message: 'SMB share remount succeeded.' },
  { id: 'n5', ts: m(75 * 60_000), severity: 'bad', source: 'nas', component: 'smart.sdc', message: 'SMART self-test FAILED: read element 18 of 19.', detail: 'disk=ST8000VN004-3CP101 serial=WKD0YYYY' },
  { id: 'n6', ts: m(95 * 60_000), severity: 'info', source: 'nas', component: 'fan.chassis', message: 'Fan profile auto-switched: silent → balanced (CPU 71°C).' },
  { id: 'n7', ts: m(3 * 3600_000), severity: 'info', source: 'nas', component: 'pool.backup', message: 'Replication snapshot sent → off-site (412 GB, 38m).' },
  { id: 'n8', ts: m(5 * 3600_000), severity: 'warn', source: 'nas', component: 'capacity.tank', message: 'Pool usage crossed 80% threshold (80.4% of 30 TB).' },
  { id: 'n9', ts: m(7 * 3600_000), severity: 'info', source: 'nas', component: 'share.docs', message: 'New SMB session: example-user@198.51.100.10' },
  { id: 'n10', ts: m(11 * 3600_000), severity: 'info', source: 'nas', component: 'system', message: 'Scheduled scrub started for pool "tank".' },
  { id: 'n11', ts: m(26 * 3600_000), severity: 'ok', source: 'nas', component: 'firmware', message: 'UNAS firmware updated to 4.2.7 (rebooted, 38s downtime).' },
];

const NETWORK_LOGS: LogEntry[] = [
  { id: 'w1', ts: m(20_000), severity: 'info', source: 'network', component: 'dhcp', message: 'DHCP lease issued: 198.51.100.10 → iPhone-ExampleUser', detail: 'mac=8c:85:90:xx:xx:xx ttl=86400' },
  { id: 'w2', ts: m(2 * 60_000), severity: 'info', source: 'network', component: 'ap.living-room', message: 'Client roamed in: MacBook-Air (-58 dBm, 5 GHz).' },
  { id: 'w3', ts: m(7 * 60_000), severity: 'warn', source: 'network', component: 'firewall', message: 'Blocked outbound: 198.51.100.10 → 185.220.101.45:443 (Tor exit).' },
  { id: 'w4', ts: m(15 * 60_000), severity: 'bad', source: 'network', component: 'wan.primary', message: 'WAN1 lost carrier — failing over to WAN2 (LTE).', detail: 'duration=43s' },
  { id: 'w5', ts: m(16 * 60_000), severity: 'ok', source: 'network', component: 'wan.primary', message: 'WAN1 restored — failed back from LTE.' },
  { id: 'w6', ts: m(31 * 60_000), severity: 'info', source: 'network', component: 'switch.usw-pro', message: 'Port 14 link up: 1 Gbps full-duplex.' },
  { id: 'w7', ts: m(48 * 60_000), severity: 'warn', source: 'network', component: 'ap.garage', message: 'Channel interference detected on 2.4 GHz (CCI 78%).' },
  { id: 'w8', ts: m(82 * 60_000), severity: 'info', source: 'network', component: 'gateway', message: 'Firmware update available: 4.0.21 → 4.1.5.' },
  { id: 'w9', ts: m(2 * 3600_000), severity: 'info', source: 'network', component: 'vpn.wireguard', message: 'Peer connected: phone (rx=12.4 MB tx=842 KB).' },
  { id: 'w10', ts: m(4 * 3600_000), severity: 'warn', source: 'network', component: 'switch.usw-pro', message: 'Port 6 flapped 3× in 60s — possibly bad cable.' },
  { id: 'w11', ts: m(6 * 3600_000), severity: 'info', source: 'network', component: 'dpi', message: 'Top talker last hour: AppleTV-LR (8.2 GB, Netflix).' },
  { id: 'w12', ts: m(22 * 3600_000), severity: 'ok', source: 'network', component: 'system', message: 'UniFi controller backup completed (487 MB).' },
];

const CAMERA_LOGS: LogEntry[] = [
  { id: 'c1', ts: m(15_000), severity: 'info', source: 'cameras', component: 'front-door', message: 'Smart-detect: person (97%).', detail: 'duration=8s zone=porch clip=motion-2891.mp4' },
  { id: 'c2', ts: m(3 * 60_000), severity: 'info', source: 'cameras', component: 'driveway', message: 'Smart-detect: vehicle (94%).', detail: 'duration=22s zone=approach' },
  { id: 'c3', ts: m(8 * 60_000), severity: 'info', source: 'cameras', component: 'porch', message: 'Smart-detect: package (88%).', detail: 'tracker=delivery clip=motion-2884.mp4' },
  { id: 'c4', ts: m(12 * 60_000), severity: 'warn', source: 'cameras', component: 'side-yard', message: 'Motion event — no smart-detect class matched.' },
  { id: 'c5', ts: m(25 * 60_000), severity: 'bad', source: 'cameras', component: 'backyard', message: 'Camera went offline (RTSP keepalive timed out).', detail: 'last_seen=25m ago retry=auto' },
  { id: 'c6', ts: m(26 * 60_000), severity: 'ok', source: 'cameras', component: 'backyard', message: 'Camera reconnected — back online.' },
  { id: 'c7', ts: m(48 * 60_000), severity: 'info', source: 'cameras', component: 'doorbell', message: 'Doorbell pressed — chime triggered, 12s 2-way audio.' },
  { id: 'c8', ts: m(72 * 60_000), severity: 'warn', source: 'cameras', component: 'garage', message: 'Lens obstruction suspected (5+ minutes low contrast).' },
  { id: 'c9', ts: m(3 * 3600_000), severity: 'info', source: 'cameras', component: 'nvr', message: 'Storage usage 62% of 8 TB — oldest clip 41d ago.' },
  { id: 'c10', ts: m(6 * 3600_000), severity: 'ok', source: 'cameras', component: 'nvr', message: 'Firmware updated: Protect 5.1.74 (38s reboot).' },
  { id: 'c11', ts: m(11 * 3600_000), severity: 'info', source: 'cameras', component: 'front-door', message: 'Recording schedule changed: continuous → motion-only.' },
];

const ALL_LOGS: LogEntry[] = [...NAS_LOGS, ...NETWORK_LOGS, ...CAMERA_LOGS].sort(
  (a, b) => b.ts - a.ts,
);

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
