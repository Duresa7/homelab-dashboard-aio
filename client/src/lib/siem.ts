import type { SyslogEvent, SiemStatus, SiemStats } from '../types';
import { apiJson } from './http';

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
  const json = await apiJson<{ disabled?: boolean; events?: SyslogEvent[] }>(`/api/siem/logs${q}`);
  if (json.disabled) return [];
  return (json.events ?? []) as SyslogEvent[];
}

export async function fetchStatus(): Promise<SiemStatus> {
  return apiJson<SiemStatus>('/api/siem/status');
}

export async function fetchStats(
  window: '15m' | '1h' | '24h' | '7d' | '30d' = '1h',
): Promise<SiemStats> {
  return apiJson<SiemStats>(`/api/siem/stats?window=${window}`);
}

export interface SiemSubscription {
  dispose(): void;
}

export interface ReplayTruncated {
  replayFromId: number;

  replayThroughId: number;
}

export interface SubscribeOptions {
  onEvent: (evt: SyslogEvent) => void;
  onStatus?: (status: SiemStatus) => void;
  onError?: (err: Event | Error) => void;

  onReplayTruncated?: (info: ReplayTruncated) => void;

  lastEventId?: number;

  statusIntervalMs?: number;
}

export function subscribeSiem(opts: SubscribeOptions): SiemSubscription {
  const {
    onEvent,
    onStatus,
    onError,
    onReplayTruncated,
    lastEventId,
    statusIntervalMs = 30_000,
  } = opts;

  let disposed = false;
  let statusTimer: ReturnType<typeof setInterval> | null = null;

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
      void 0;
    }
  };
  es.addEventListener('replay-truncated', (msg) => {
    if (disposed) return;
    try {
      const info = JSON.parse((msg as MessageEvent).data) as ReplayTruncated;
      onReplayTruncated?.(info);
    } catch {
      void 0;
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
      try {
        es.close();
      } catch {
        void 0;
      }
      if (statusTimer) clearInterval(statusTimer);
    },
  };
}
