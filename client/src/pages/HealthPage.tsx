import { useCallback, useEffect, useState } from 'react';
import { INTEGRATIONS } from '../lib/integrations';
import type { IntegrationKey } from '../lib/telemetry';

interface Props {
  integrations: Record<IntegrationKey, boolean>;
}

type ProbeStatus = 'ok' | 'down' | 'skipped';

interface ProbeResult {
  name: string;
  status: ProbeStatus;
  ok: boolean | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string | null;
}

interface LiveHealth {
  ok: boolean;
  checkedAt: string;
  summary: { total: number; ok: number; down: number; skipped: number };
  integrations: Record<string, ProbeResult>;
  fromCache?: boolean;
  ageMs?: number;
  cacheTtlMs?: number;
}

function statusKind(p: ProbeResult | undefined, clientEnabled: boolean) {
  if (!clientEnabled) return { kind: 'info' as const, label: 'paused' };
  if (!p) return { kind: 'info' as const, label: 'unknown' };
  if (p.status === 'skipped') return { kind: 'info' as const, label: 'not configured' };
  if (p.status === 'ok') return { kind: 'ok' as const, label: 'reachable' };
  return { kind: 'bad' as const, label: 'unreachable' };
}

function fmtLatency(ms: number | null): { label: string; kind: '' | 'warn' | 'bad' } {
  if (ms == null) return { label: '—', kind: '' };
  if (ms >= 2000) return { label: `${ms} ms`, kind: 'bad' };
  if (ms >= 750) return { label: `${ms} ms`, kind: 'warn' };
  return { label: `${ms} ms`, kind: '' };
}

function fmtStamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString();
}

function fmtAge(ms: number | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms ago`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

export function HealthPage({ integrations }: Props) {
  const [data, setData] = useState<LiveHealth | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/health/live${refresh ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LiveHealth;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const summary = data?.summary;
  const probes = data?.integrations ?? {};

  return (
    <div className="page">
      <div className="health-summary">
        <div className="hs-meta">
          <div className="hs-title">
            API Health
            {summary ? (
              <span className="hs-counts">
                <span className="pill ok"><span className="dot" />{summary.ok}&nbsp;ok</span>
                <span className="pill bad"><span className="dot" />{summary.down}&nbsp;down</span>
                <span className="pill info"><span className="dot" />{summary.skipped}&nbsp;skipped</span>
              </span>
            ) : null}
          </div>
          <div className="hs-stamp">
            {data ? (
              <>
                Last checked <b>{fmtStamp(data.checkedAt)}</b>
                {data.fromCache ? <> · cached ({fmtAge(data.ageMs)})</> : <> · live</>}
                {data.cacheTtlMs ? <> · ttl {Math.round(data.cacheTtlMs / 1000)}s</> : null}
              </>
            ) : loading ? (
              'Probing upstreams…'
            ) : error ? (
              <span className="text-bad">Failed: {error}</span>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div className="hs-actions">
          <button
            type="button"
            className="btn"
            onClick={() => load(false)}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => load(true)}
            disabled={loading}
          >
            Re-check now
          </button>
        </div>
      </div>

      <div className="health-table-wrap">
        <table className="health-table">
          <thead>
            <tr>
              <th>Integration</th>
              <th>Status</th>
              <th className="num">Latency</th>
              <th>Last error</th>
              <th>Checked</th>
            </tr>
          </thead>
          <tbody>
            {INTEGRATIONS.map((def) => {
              const clientEnabled = !!integrations[def.key];
              const p = probes[def.healthField];
              const s = statusKind(p, clientEnabled);
              const lat = fmtLatency(p?.latencyMs ?? null);
              const isDown = p?.status === 'down';
              return (
                <tr key={def.key}>
                  <td>
                    <div className="h-name">
                      <b>{def.label}</b>
                    </div>
                  </td>
                  <td>
                    <span className={`pill ${s.kind}`}>
                      <span className="dot" />
                      {s.label}
                    </span>
                  </td>
                  <td className="num">
                    <span className={`h-lat ${lat.kind}`}>{lat.label}</span>
                  </td>
                  <td>
                    {isDown && p?.error ? (
                      <code className="h-err bad" title={p.error}>{p.error}</code>
                    ) : (
                      <span className="h-err">—</span>
                    )}
                  </td>
                  <td>
                    <span className="h-stamp">{fmtStamp(p?.checkedAt ?? null)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
