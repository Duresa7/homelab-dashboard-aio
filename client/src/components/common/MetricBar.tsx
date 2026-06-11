import type { ReactNode } from 'react';
import type { Severity } from '../../types';
import { severityColor } from '../../lib/severity';
import { cn } from '@/lib/utils';

export interface MetricBarProps {
  label: ReactNode;

  pct: number;

  value?: ReactNode;

  tone?: Severity;

  color?: string;
  className?: string;
}

export function MetricBar({ label, pct, value, tone, color, className }: MetricBarProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const fill = tone ? severityColor[tone] : (color ?? 'var(--accent)');
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="w-8 shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
        style={{ background: 'var(--bg-3)' }}
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%`, background: fill }}
        />
      </span>
      <span className="shrink-0 text-right text-xs font-medium tabular-nums text-foreground">
        {value ?? `${Math.round(clamped)}%`}
      </span>
    </div>
  );
}
