import type { ReactNode } from 'react';
import { SectionCard } from './SectionCard';

export interface ChartCardProps {
  title?: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  span?: number;

  height?: number;

  empty?: ReactNode;
  isEmpty?: boolean;
  children?: ReactNode;
  className?: string;
}

export function ChartCard({
  title,
  sub,
  icon,
  actions,
  span = 6,
  height = 120,
  empty = 'Waiting for history samples',
  isEmpty = false,
  children,
  className,
}: ChartCardProps) {
  return (
    <SectionCard
      span={span}
      title={title}
      sub={sub}
      icon={icon}
      actions={actions}
      className={className}
    >
      {isEmpty ? (
        <div
          className="grid place-items-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
          style={{ height }}
        >
          {empty}
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </SectionCard>
  );
}
