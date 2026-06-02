import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
}

export function EventsPage({ data }: Props) {
  const events = data.events;
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {events.length} entries
        </span>
      </div>
      {events.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No events recorded</div>
      ) : (
        <div className="flex flex-col">
          {events.map((e, i) => (
            <div
              key={i}
              className="flex items-start gap-3 border-b border-border/60 py-2.5 last:border-0"
            >
              <span className="w-14 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-[var(--ink-4)]">
                {e.ts}
              </span>
              <span className={`status-dot ${e.kind} mt-[7px] shrink-0`} />
              <div className="flex min-w-0 flex-col">
                <b className="text-sm font-medium text-foreground">{e.title}</b>
                <span className="text-sm text-muted-foreground">{e.body}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
