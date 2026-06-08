import { Plus, Trash2, X } from 'lucide-react';

import { genId, nextDeviceUid, type DeviceCategory, type Device } from '../../lib/inventory';
import { BrandGlyph, categoryIcon } from '../../lib/inventoryIcons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SectionCard } from '@/components/common';
import { cn } from '@/lib/utils';

import { Editable } from './Editable';
import { ADD_ROW_BTN, GHOST_ICON_BTN, pad2 } from './shared';

interface CategoryBlockProps {
  category: DeviceCategory;
  items: Device[];
  deployment: 'in-service' | 'spare';
  isEditing: boolean;
  onChange: (mut: (c: DeviceCategory) => DeviceCategory) => void;
  onDelete: () => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

export function CategoryBlock({
  category,
  items,
  deployment,
  isEditing,
  onChange,
  onDelete,
  onOpenItem,
  openItemId,
}: CategoryBlockProps) {
  const CatIcon = categoryIcon(category.name);
  const setName = (name: string) => onChange((cur) => ({ ...cur, name }));
  const setNote = (note: string) =>
    onChange((cur) => ({ ...cur, note: note.length > 0 ? note : undefined }));

  const setItemValue = (itemId: string, colId: string, v: string) =>
    onChange((cur) => ({
      ...cur,
      items: cur.items.map((it) =>
        it.id === itemId ? { ...it, values: { ...it.values, [colId]: v } } : it,
      ),
    }));
  const setItemName = (itemId: string, v: string) =>
    onChange((cur) => ({
      ...cur,
      items: cur.items.map((it) => (it.id === itemId ? { ...it, name: v || undefined } : it)),
    }));

  const addItem = () =>
    onChange((cur) => ({
      ...cur,
      items: [
        ...cur.items,
        {
          id: genId('s'),
          values: {},
          deployment,
          ids: {
            uid: nextDeviceUid(
              cur.prefix ?? '09',
              cur.items.map((it) => it.ids?.uid),
            ),
          },
          status: 'working',
          purchase: {},
          problemLog: [],
        },
      ],
    }));
  const removeItem = (itemId: string) =>
    onChange((cur) => ({ ...cur, items: cur.items.filter((it) => it.id !== itemId) }));

  const setColumnLabel = (colId: string, label: string) =>
    onChange((cur) => ({
      ...cur,
      columns: cur.columns.map((c) => (c.id === colId ? { ...c, label } : c)),
    }));

  const hasName =
    category.deviceType === 'network' ||
    category.deviceType === 'laptop' ||
    items.some((it) => it.name);
  const colSpan = category.columns.length + 1 + (hasName ? 1 : 0) + (isEditing ? 1 : 0);

  return (
    <SectionCard flush>
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="shrink-0 text-muted-foreground [&_svg]:size-4">
          <CatIcon size={16} strokeWidth={1.75} />
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground" title="UID block">
          {category.prefix ?? '09'}xx
        </span>
        <h3 className="min-w-0 font-display text-base text-foreground">
          <Editable
            value={category.name}
            editing={isEditing}
            onChange={setName}
            placeholder="Category name"
          />
        </h3>
        <Badge variant="secondary" className="font-mono tabular-nums">
          {pad2(items.length)} item{items.length === 1 ? '' : 's'}
        </Badge>
        {isEditing ? (
          <button
            type="button"
            className={cn(GHOST_ICON_BTN, 'ml-auto')}
            onClick={onDelete}
            title="Delete category"
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      {category.note || isEditing ? (
        <div className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
          <Editable
            value={category.note ?? ''}
            editing={isEditing}
            onChange={setNote}
            placeholder="Optional note for this category"
            muted
          />
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16">UID</TableHead>
            {hasName ? <TableHead>Name</TableHead> : null}
            {category.columns.map((col) => (
              <TableHead key={col.id} className={col.align === 'right' ? 'text-right' : ''}>
                <Editable
                  value={col.label}
                  editing={isEditing}
                  onChange={(v) => setColumnLabel(col.id, v)}
                  placeholder="Column"
                />
              </TableHead>
            ))}
            {isEditing ? <TableHead className="w-10" aria-label="Row actions" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colSpan} className="py-6 text-center text-muted-foreground">
                No items here yet.
              </TableCell>
            </TableRow>
          ) : null}
          {items.map((it) => {
            const openRow = (e: React.MouseEvent<HTMLTableRowElement>) => {
              if (
                (e.target as HTMLElement).closest(
                  'input, textarea, button, a, [contenteditable="true"]',
                )
              )
                return;
              onOpenItem(it.id);
            };
            return (
              <TableRow
                key={it.id}
                className={cn('cursor-pointer', openItemId === it.id && 'bg-muted/50')}
                onClick={openRow}
              >
                <TableCell className="font-mono tabular-nums text-muted-foreground">
                  {it.ids?.uid ?? '—'}
                </TableCell>
                {hasName ? (
                  <TableCell className="font-medium text-foreground">
                    <Editable
                      value={it.name ?? ''}
                      editing={isEditing}
                      onChange={(v) => setItemName(it.id, v)}
                      placeholder="—"
                    />
                  </TableCell>
                ) : null}
                {category.columns.map((col) => {
                  const value = it.values[col.id] ?? '';
                  const isBrand = col.id === 'brand';
                  const isMono = col.id === 'model' || col.id === 'part' || col.align === 'right';
                  return (
                    <TableCell
                      key={col.id}
                      className={col.align === 'right' ? 'text-right tabular-nums' : ''}
                    >
                      {isBrand ? (
                        <span className="flex items-center gap-2">
                          <BrandGlyph text={value} size={16} reserveSpace />
                          <Editable
                            value={value}
                            editing={isEditing}
                            onChange={(v) => setItemValue(it.id, col.id, v)}
                            placeholder="—"
                            mono={isMono}
                          />
                        </span>
                      ) : (
                        <Editable
                          value={value}
                          editing={isEditing}
                          onChange={(v) => setItemValue(it.id, col.id, v)}
                          placeholder="—"
                          mono={isMono}
                        />
                      )}
                    </TableCell>
                  );
                })}
                {isEditing ? (
                  <TableCell>
                    <button
                      type="button"
                      className={GHOST_ICON_BTN}
                      onClick={() => removeItem(it.id)}
                      title="Remove row"
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

      {isEditing ? (
        <div className="border-t border-border px-4 py-2">
          <button type="button" className={ADD_ROW_BTN} onClick={addItem}>
            <Plus size={12} strokeWidth={2} /> add item
          </button>
        </div>
      ) : null}
    </SectionCard>
  );
}
