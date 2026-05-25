import type { SyslogEvent, SiemStatus, SiemStats } from '../types';

export interface FetchLogsQuery {
  since?: number;
  until?: number;
  severity?: string | number | number[];
  deviceKind?: string;
  category?: string;
  sourceIp?: string;
  q?: string;
  afterId?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}

function toQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) sp.set(k, v.join(','));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function fetchLogs(query: FetchLogsQuery = {}): Promise<SyslogEvent[]> {
  const q = toQuery({
    since: query.since,
    until: query.until,
    severity: query.severity,
    device_kind: query.deviceKind,
    category: query.category,
    source_ip: query.sourceIp,
    q: query.q,
    after_id: query.afterId,
    limit: query.limit,
    order: query.order,
  });
  const res = await fetch(`/api/siem/logs${q}`);
  if (!res.ok) throw new Error(`SIEM logs ${res.status}`);
  const json = await res.json();
  if (json.disabled) return [];
  return (json.events ?? []) as SyslogEvent[];
}

export async function fetchStatus(): Promise<SiemStatus> {
  const res = await fetch('/api/siem/status');
  if (!res.ok) throw new Error(`SIEM status ${res.status}`);
  return (await res.json()) as SiemStatus;
}

export async function fetchStats(window: '15m' | '1h' | '24h' | '7d' | '30d' = '1h'): Promise<SiemStats> {
  const res = await fetch(`/api/siem/stats?window=${window}`);
  if (!res.ok) throw new Error(`SIEM stats ${res.status}`);
  return (await res.json()) as SiemStats;
}

export interface SiemSubscription {
  dispose(): void;
}

export interface ReplayTruncated {
  /** Lowest id we asked for (exclusive) — i.e. the client's last seen id. */
  replayFromId: number;
  /** Highest id the server actually replayed; events in (from, through] arrived. */
  replayThroughId: number;
}

export interface SubscribeOptions {
  onEvent: (evt: SyslogEvent) => void;
  onStatus?: (status: SiemStatus) => void;
  onError?: (err: Event | Error) => void;
  /** Server signals when replay was capped and the client should backfill via fetchLogs. */
  onReplayTruncated?: (info: ReplayTruncated) => void;
  /** Resume after this DB id; the backend replays anything newer. */
  lastEventId?: number;
  /** Status poll cadence (ms). Default 30s. */
  statusIntervalMs?: number;
}

export function subscribeSiem(opts: SubscribeOptions): SiemSubscription {
  const { onEvent, onStatus, onError, onReplayTruncated, lastEventId, statusIntervalMs = 30_000 } = opts;

  let disposed = false;
  let statusTimer: ReturnType<typeof setInterval> | null = null;

  // EventSource has no API for the Last-Event-ID header on the initial GET, so pass it as a query.
  const url = lastEventId
    ? `/api/siem/stream?lastEventId=${encodeURIComponent(String(lastEventId))}`
    : '/api/siem/stream';
  const es = new EventSource(url);

  es.onmessage = (msg) => {
    if (disposed) return;
    try {
      const evt = JSON.parse(msg.data) as SyslogEvent;
      onEvent(evt);
    } catch {
      /* drop malformed message */
    }
  };
  es.addEventListener('replay-truncated', (msg) => {
    if (disposed) return;
    try {
      const info = JSON.parse((msg as MessageEvent).data) as ReplayTruncated;
      onReplayTruncated?.(info);
    } catch {
      /* drop malformed marker */
    }
  });
  es.onerror = (e) => {
    if (disposed) return;
    onError?.(e);
  };

  async function pollStatus() {
    if (disposed || !onStatus) return;
    try {
      onStatus(await fetchStatus());
    } catch (err) {
      onError?.(err as Error);
    }
  }
  if (onStatus) {
    void pollStatus();
    statusTimer = setInterval(pollStatus, statusIntervalMs);
  }

  return {
    dispose() {
      disposed = true;
      try { es.close(); } catch { /* ignore */ }
      if (statusTimer) clearInterval(statusTimer);
    },
  };
}
