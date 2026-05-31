import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { spanClass } from './spans';

export interface SectionCardProps {
  title?: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Column span against the 12-col page grid (3/4/6/8/12…). */
  span?: number;
  /** Remove body padding — for full-bleed tables. */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/**
 * The canonical content card: rounded surface, soft border + shadow, optional
 * uppercase-muted header. Replaces the legacy `.tile`/`.t-head` structure.
 */
export function SectionCard({
  title,
  sub,
  icon,
  actions,
  span = 12,
  flush = false,
  children,
  className,
  bodyClassName,
}: SectionCardProps) {
  const hasHeader = title != null || actions != null;
  const bodyPad = flush ? '' : hasHeader ? 'px-[var(--pad)] pb-[var(--pad)]' : 'p-[var(--pad)]';

  return (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card',
        spanClass(span),
        className,
      )}
    >
      {hasHeader ? (
        <header className="flex flex-wrap items-center justify-between gap-3 px-[var(--pad)] pt-[var(--pad)] pb-3">
          <div className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold tracking-wide text-muted-foreground">
            {icon ? <span className="shrink-0 [&_svg]:size-3.5">{icon}</span> : null}
            <span className="truncate">{title}</span>
            {sub != null ? (
              <span className="font-normal text-muted-foreground/70 tabular-nums">· {sub}</span>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(bodyPad, bodyClassName)}>{children}</div>
    </section>
  );
}
