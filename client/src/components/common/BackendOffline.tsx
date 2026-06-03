import { CloudOff } from 'lucide-react';

export interface BackendOfflineProps {
  reason: string | null;
}

export function BackendOffline({ reason }: BackendOfflineProps) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-warn/40 bg-card p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-warn/30 bg-warn/10 text-warn">
          <CloudOff strokeWidth={1.75} className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg tracking-tight text-foreground">
              Backend unreachable
            </h2>
            <code className="rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-warn">
              BACKEND_UNREACHABLE
            </code>
          </div>
          <p className="text-sm text-muted-foreground">
            Start the backend with{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npm run server</code>{' '}
            to restore live dashboard data.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Reason
        </div>
        <code className="block break-words font-mono text-xs text-foreground">
          {reason ?? 'No reason reported'}
        </code>
      </div>
    </section>
  );
}
