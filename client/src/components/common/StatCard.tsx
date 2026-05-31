import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { spanClass } from './spans';

export type StatTone = 'ok' | 'warn' | 'bad' | 'info' | 'default';

const TONE: Record<StatTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  default: 'text-foreground',
};

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  span?: number;
  className?: string;
}

/** A KPI tile — big display number over an uppercase label. Replaces `.t-big`. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  span = 3,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-[var(--pad)] shadow-card',
        spanClass(span),
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {icon ? <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
      </div>
      <span className={cn('font-display text-[2rem] leading-none font-semibold tabular-nums', TONE[tone])}>
        {value}
      </span>
      {hint != null ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** Vertical stack of key/value rows. Replaces `<dl className="kv">`. */
export function StatList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col', className)}>{children}</div>;
}

export function StatRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 border-b border-border/60 py-1.5 last:border-0',
        className,
      )}
    >
      <span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span>
      <span className="shrink-0 text-right text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
