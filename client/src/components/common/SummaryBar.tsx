import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { spanClass } from './spans';
import type { StatTone } from './StatCard';

const TONE: Record<StatTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  default: 'text-foreground',
};

export interface SummaryStat {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Optional secondary line under the value (e.g. "8/12 cores"). */
  sub?: ReactNode;
  tone?: StatTone;
  icon?: ReactNode;
}

export interface SummaryBarProps {
  stats: SummaryStat[];
  span?: number;
  className?: string;
}

/**
 * A compact, single-card KPI strip — several headline stats separated by thin
 * dividers, wrapping to a grid on narrow widths. Anchors a page (cluster
 * totals, overall health) without the dead space of one-stat-per-card rows.
 */
export function SummaryBar({ stats, span = 12, className }: SummaryBarProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border bg-card px-[var(--pad)] py-4 shadow-card sm:grid-cols-3 lg:flex lg:items-center lg:gap-0',
        spanClass(span),
        className,
      )}
    >
      {stats.map((s, i) => (
        <div
          key={s.key}
          className={cn(
            'flex min-w-0 flex-col gap-0.5 lg:flex-1 lg:px-5 lg:first:pl-0',
            i > 0 && 'lg:border-l lg:border-border',
          )}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {s.icon ? <span className="[&_svg]:size-3.5">{s.icon}</span> : null}
            {s.label}
          </span>
          <span
            className={cn(
              'font-display text-2xl leading-none font-semibold tracking-tight tabular-nums',
              TONE[s.tone ?? 'default'],
            )}
          >
            {s.value}
          </span>
          {s.sub != null ? (
            <span className="truncate text-xs text-muted-foreground tabular-nums">{s.sub}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
