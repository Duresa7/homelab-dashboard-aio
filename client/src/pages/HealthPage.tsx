import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
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
  if (ms >= 2000) return { label: `${ms} ms`, kind: 'bad' };
  if (ms >= 750) return { label: `${ms} ms`, kind: 'warn' };
  return { label: `${ms} ms`, kind: '' };
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
    <div className="flex flex-col gap-[var(--page-gap)]">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-card">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-lg tracking-tight text-foreground">API Health</h2>
            {summary ? (
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge kind="ok">{summary.ok} ok</StatusBadge>
                <StatusBadge kind="bad">{summary.down} down</StatusBadge>
                <StatusBadge kind="info">{summary.skipped} skipped</StatusBadge>
              </div>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {data ? (
              <>
                Last checked{' '}
                <b className="font-medium text-foreground">{fmtStamp(data.checkedAt)}</b>
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => load(false)} disabled={loading}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Re-check now
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Integration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Latency</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>Checked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data
              ? INTEGRATIONS.map((def) => (
                  <TableRow key={def.key}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-4 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                  </TableRow>
                ))
              : INTEGRATIONS.map((def) => {
                  const clientEnabled = !!integrations[def.key];
                  const p = probes[def.healthField];
                  const s = statusKind(p, clientEnabled);
                  const lat = fmtLatency(p?.latencyMs ?? null);
                  const isDown = p?.status === 'down';
                  return (
                    <TableRow key={def.key}>
                      <TableCell className="font-medium text-foreground">{def.label}</TableCell>
                      <TableCell>
                        <StatusBadge kind={s.kind}>{s.label}</StatusBadge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            lat.kind === 'bad'
                              ? 'text-bad'
                              : lat.kind === 'warn'
                                ? 'text-warn'
                                : 'text-muted-foreground'
                          }
                        >
                          {lat.label}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        {isDown && p?.error ? (
                          <code
                            className="block truncate font-mono text-xs text-bad"
                            title={p.error}
                          >
                            {p.error}
                          </code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {fmtStamp(p?.checkedAt ?? null)}
                      </TableCell>
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
