import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { spanClass } from './spans';
import { MetricBar, type MetricBarProps } from './MetricBar';
import { StatusBadge, type StatusKind } from './StatusBadge';

export interface EntityMetric extends MetricBarProps {
  key: string;
}

export interface EntityMeta {
  /** Short caption, e.g. an icon-less fact like "↑ 41d" or "192.0.2.5". */
  label?: ReactNode;
  value: ReactNode;
  key: string;
}

export interface EntityCardProps {
  /** Primary identity — hostname/name. */
  name: ReactNode;
  /** Optional secondary line under the name (model, type, IP…). */
  subtitle?: ReactNode;
  /** Leading type/brand icon. */
  icon?: ReactNode;
  /** Status dot + pill. */
  status?: StatusKind;
  statusLabel?: ReactNode;
  /** Usage bars (CPU/RAM/disk…). */
  metrics?: EntityMetric[];
  /** Footer key facts, rendered as a wrapped dot-separated row. */
  meta?: EntityMeta[];
  /** Makes the whole card an interactive drill-in affordance. */
  onClick?: () => void;
  span?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * The canonical entity tile: a status-headed card with usage bars and a row of
 * key facts, optionally clickable to drill in. One pattern for Proxmox nodes,
 * Docker hosts, NAS pools, network devices, and inventory machines — chosen to
 * surface dense per-entity info without dead space.
 */
export function EntityCard({
  name,
  subtitle,
  icon,
  status = 'idle',
  statusLabel,
  metrics,
  meta,
  onClick,
  span = 4,
  className,
  children,
}: EntityCardProps) {
  const interactive = typeof onClick === 'function';
  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      {...(interactive ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'group flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-[var(--pad)] text-left shadow-card transition-all duration-200',
        interactive &&
          'cursor-pointer hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        spanClass(span),
        className,
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: `var(--${status})` }}
            aria-hidden
          />
          {icon ? (
            <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
          ) : null}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              {name}
            </span>
            {subtitle != null ? (
              <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {statusLabel != null ? (
            <StatusBadge kind={status} dot={false}>
              {statusLabel}
            </StatusBadge>
          ) : null}
          {interactive ? (
            <ChevronRight className="size-4 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
          ) : null}
        </div>
      </header>

      {metrics && metrics.length > 0 ? (
        <div className="flex flex-col gap-2">
          {metrics.map(({ key, ...m }) => (
            <MetricBar key={key} {...m} />
          ))}
        </div>
      ) : null}

      {children}

      {meta && meta.length > 0 ? (
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground tabular-nums">
          {meta.map((m, i) => (
            <span key={m.key} className="flex items-center gap-2">
              {i > 0 ? <span className="text-border">·</span> : null}
              {m.label != null ? <span className="text-muted-foreground/70">{m.label}</span> : null}
              <span className="text-foreground/80">{m.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </Tag>
  );
}
