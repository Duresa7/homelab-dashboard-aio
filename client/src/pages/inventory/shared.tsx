import type { ReactNode } from 'react';

import {
  COMPONENT_BLOCKS,
  componentTitle,
  type Component,
  type ComponentType,
  type Machine,
  type Device,
} from '../../lib/inventory';
import { categoryIcon } from '../../lib/inventoryIcons';
import type { StatusKind } from '@/components/common';

export type Tab = 'machines' | 'network' | 'service' | 'devices';
export type Mode = 'browse' | 'edit';

export interface Chip {
  id: string;
  label: string;
  count: number;
  icon?: ReactNode;
}

export const GHOST_ICON_BTN =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-bad';
export const ADD_ROW_BTN =
  'inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-brand';

/** Component types in UID-block order, for stable grouping. */
export const TYPE_ORDER = (Object.entries(COMPONENT_BLOCKS) as [ComponentType, number][])
  .sort((a, b) => a[1] - b[1])
  .map(([t]) => t);

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center text-sm text-muted-foreground shadow-card">
      {children}
    </div>
  );
}

export function iconOf(Icon: ReturnType<typeof categoryIcon>): ReactNode {
  return <Icon className="size-3" strokeWidth={1.75} />;
}

export function matchMachine(m: Machine, q: string): boolean {
  if (!q) return true;
  return `${m.name} ${m.role} ${m.meta.map((r) => `${r.label} ${r.value}`).join(' ')}`
    .toLowerCase()
    .includes(q);
}
export function matchItem(it: Device, q: string): boolean {
  if (!q) return true;
  return `${it.name ?? ''} ${Object.values(it.values).join(' ')}`.toLowerCase().includes(q);
}
export function matchComponent(c: Component, q: string): boolean {
  if (!q) return true;
  return `${c.label} ${componentTitle(c)} ${c.fields.map((f) => f.value).join(' ')} ${c.ids?.uid ?? ''}`
    .toLowerCase()
    .includes(q);
}

export function statusKind(s: string): StatusKind {
  if (s === 'working') return 'ok';
  if (s === 'broken') return 'bad';
  if (s === 'in-repair') return 'warn';
  return 'idle';
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function slugColumn(label: string, taken: string[] = []): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'col';
  let id = base;
  let n = 2;
  while (taken.includes(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

export function csvCell(s: string): string {
  const safe = /^[\s]*[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
