import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: ReactNode;

  eyebrow?: ReactNode;
  sub?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  eyebrow,
  sub,
  badges,
  actions,
  icon,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-card',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow != null ? (
          <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {eyebrow}
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {icon ? <span className="text-brand [&_svg]:size-5">{icon}</span> : null}
          <h2 className="font-display text-lg tracking-tight text-foreground">{title}</h2>
          {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
        </div>
        {sub != null ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
