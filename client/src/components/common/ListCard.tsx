import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SectionCard } from './SectionCard';
import type { StatusKind } from './StatusBadge';

export interface ListCardProps {
  title?: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  span?: number;
  isEmpty?: boolean;
  empty?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function ListCard({
  title,
  sub,
  icon,
  actions,
  span = 6,
  isEmpty = false,
  empty = 'Nothing to show',
  children,
  className,
}: ListCardProps) {
  return (
    <SectionCard
      span={span}
      title={title}
      sub={sub}
      icon={icon}
      actions={actions}
      className={className}
      bodyClassName="flex flex-col"
    >
      {isEmpty ? (
        <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        children
      )}
    </SectionCard>
  );
}

export interface ListRowProps {
  dot?: StatusKind;
  name: ReactNode;

  meta?: ReactNode;

  value?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ListRow({ dot, name, meta, value, onClick, className }: ListRowProps) {
  const interactive = typeof onClick === 'function';
  const Tag = interactive ? 'button' : 'div';
  return (
    <Tag
      {...(interactive ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex items-center gap-2.5 border-b border-border/60 py-2 text-left last:border-0',
        interactive &&
          'cursor-pointer rounded-md transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]',
        className,
      )}
    >
      {dot ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: `var(--${dot})` }}
          aria-hidden
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        {meta != null ? (
          <span className="truncate text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {value != null ? (
        <span className="shrink-0 text-right text-sm font-medium tabular-nums text-muted-foreground">
          {value}
        </span>
      ) : null}
    </Tag>
  );
}
