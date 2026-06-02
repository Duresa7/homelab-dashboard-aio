import { X } from 'lucide-react';

import { componentTitle, type Component } from '../../lib/inventory';
import { BrandGlyph } from '../../lib/inventoryIcons';
import { StatusBadge } from '@/components/common';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { GHOST_ICON_BTN, statusKind } from './shared';

/** Shared table for a list of pool components (UID · Part · Spec · Status). */
export function ComponentTable({
  items,
  isEditing,
  onOpenItem,
  openItemId,
  onDelete,
}: {
  items: Component[];
  isEditing: boolean;
  onOpenItem: (id: string) => void;
  openItemId?: string;
  onDelete?: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-20">UID</TableHead>
          <TableHead>Component</TableHead>
          <TableHead>Part</TableHead>
          <TableHead>Spec</TableHead>
          <TableHead className="text-right">Status</TableHead>
          {isEditing ? <TableHead className="w-10" aria-label="Row actions" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((c) => {
          const st = c.status ?? 'working';
          const title = componentTitle(c);
          const summary = c.fields
            .filter((f) => !/^(brand|model)$/i.test(f.label) && f.value.trim())
            .map((f) => f.value)
            .slice(0, 4)
            .join(' · ');
          return (
            <TableRow
              key={c.id}
              className={cn('cursor-pointer', openItemId === c.id && 'bg-muted/50')}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('button')) onOpenItem(c.id);
              }}
            >
              <TableCell className="font-mono tabular-nums text-muted-foreground">
                {c.ids?.uid ?? '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">{c.label}</TableCell>
              <TableCell>
                <span className="flex items-center gap-2 text-foreground">
                  <BrandGlyph text={title} size={16} reserveSpace />
                  <span className="font-medium">{title}</span>
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{summary || '—'}</TableCell>
              <TableCell className="text-right">
                <StatusBadge kind={statusKind(st)}>{st}</StatusBadge>
              </TableCell>
              {isEditing ? (
                <TableCell>
                  <button
                    type="button"
                    className={GHOST_ICON_BTN}
                    onClick={() => onDelete?.(c.id)}
                    title="Delete component"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
