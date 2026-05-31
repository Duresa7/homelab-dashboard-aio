import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SectionCard } from './SectionCard';
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/table';

export interface DataTableCardProps {
  title?: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  span?: number;
  /** The `<TableHead>` cells for the header row. */
  head: ReactNode;
  /** The `<TableRow>` body rows. */
  children: ReactNode;
  isEmpty?: boolean;
  empty?: ReactNode;
  className?: string;
  tableClassName?: string;
}

/** A shadcn `<Table>` inside a flush SectionCard. Replaces every legacy `.data-table`. */
export function DataTableCard({
  title,
  sub,
  icon,
  actions,
  span = 12,
  head,
  children,
  isEmpty = false,
  empty = 'No data',
  className,
  tableClassName,
}: DataTableCardProps) {
  const hasHeader = title != null || actions != null;
  return (
    <SectionCard title={title} sub={sub} icon={icon} actions={actions} span={span} flush className={className}>
      {isEmpty ? (
        <div className="px-[var(--pad)] py-10 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className={cn(hasHeader && 'border-t border-border')}>
          <Table className={tableClassName}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">{head}</TableRow>
            </TableHeader>
            <TableBody>{children}</TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
