import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusKind = 'ok' | 'warn' | 'bad' | 'info' | 'idle';

/** Tinted outline using color-mix so each kind flips automatically in dark mode. */
const KIND: Record<StatusKind, string> = {
  ok: 'border-[color-mix(in_oklab,var(--ok)_30%,transparent)] bg-[color-mix(in_oklab,var(--ok)_10%,transparent)] text-[var(--ok)]',
  warn: 'border-[color-mix(in_oklab,var(--warn)_30%,transparent)] bg-[color-mix(in_oklab,var(--warn)_10%,transparent)] text-[var(--warn)]',
  bad: 'border-[color-mix(in_oklab,var(--bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--bad)_10%,transparent)] text-[var(--bad)]',
  info: 'border-[color-mix(in_oklab,var(--info)_30%,transparent)] bg-[color-mix(in_oklab,var(--info)_10%,transparent)] text-[var(--info)]',
  idle: 'border-border bg-transparent text-muted-foreground',
};

export interface StatusBadgeProps {
  kind?: StatusKind;
  /** Show the leading severity dot (default true). */
  dot?: boolean;
  /** Pulse the dot — for live/active states. */
  pulse?: boolean;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Status pill on top of shadcn Badge. Replaces the legacy `.pill .ok/.warn/.bad`. */
export function StatusBadge({
  kind = 'idle',
  dot = true,
  pulse = false,
  title,
  children,
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn('gap-1.5 font-medium lowercase tabular-nums', KIND[kind], className)}
    >
      {dot ? (
        <span className={cn('size-1.5 shrink-0 rounded-full bg-current', pulse && 'icon-pulse')} />
      ) : null}
      {children}
    </Badge>
  );
}
