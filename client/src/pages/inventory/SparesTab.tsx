import { Cpu, Plus } from 'lucide-react';

import {
  COMPONENT_TYPE_LABELS,
  SPARE,
  type ComponentType,
  type Inventory,
  type DeviceCategory,
} from '../../lib/inventory';
import { categoryIcon, componentIcon } from '../../lib/inventoryIcons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/common';
import { cn } from '@/lib/utils';

import { CategoryBlock } from './CategoryBlock';
import { ComponentTable } from './ComponentTable';
import {
  EmptyState,
  TYPE_ORDER,
  iconOf,
  matchComponent,
  matchItem,
  pad2,
  type Chip,
} from './shared';

interface SparesTabProps {
  inv: Inventory;
  isEditing: boolean;
  query: string;
  filter: string;
  setFilter: (s: string) => void;
  updateCategory: (id: string, mut: (c: DeviceCategory) => DeviceCategory) => void;
  deleteCategory: (id: string) => void;
  addCategory: () => void;
  addComponent: (type: ComponentType, assignment: string) => void;
  deleteComponent: (id: string) => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

export function SparesTab({
  inv,
  isEditing,
  query,
  filter,
  setFilter,
  updateCategory,
  deleteCategory,
  addCategory,
  addComponent,
  deleteComponent,
  onOpenItem,
  openItemId,
}: SparesTabProps) {
  // Spare device categories (items with deployment 'spare').
  const deviceGroups = inv.devices
    .map((cat) => ({
      cat,
      items: cat.items.filter(
        (it) => (it.deployment ?? 'spare') === 'spare' && matchItem(it, query),
      ),
    }))
    .filter((g) => g.items.length > 0 || isEditing);

  // Spare components from the pool, grouped by type.
  const sparePool = inv.components.filter(
    (c) => c.assignment === SPARE && matchComponent(c, query),
  );
  const compGroups = TYPE_ORDER.map((type) => ({
    type,
    items: sparePool.filter((c) => c.type === type),
  })).filter((g) => g.items.length > 0);

  const chips: Chip[] = [
    {
      id: 'all',
      label: 'All',
      count: deviceGroups.reduce((n, g) => n + g.items.length, 0) + sparePool.length,
    },
    ...deviceGroups.map((g) => ({
      id: `cat:${g.cat.id}`,
      label: g.cat.name,
      count: g.items.length,
      icon: iconOf(categoryIcon(g.cat.name)),
    })),
    ...compGroups.map((g) => ({
      id: `type:${g.type}`,
      label: COMPONENT_TYPE_LABELS[g.type],
      count: g.items.length,
      icon: iconOf(componentIcon(COMPONENT_TYPE_LABELS[g.type]) ?? Cpu),
    })),
  ];

  const showCat = (id: string) => filter === 'all' || filter === `cat:${id}`;
  const showType = (t: ComponentType) => filter === 'all' || filter === `type:${t}`;

  const empty = deviceGroups.every((g) => g.items.length === 0) && compGroups.length === 0;
  if (empty && !isEditing) {
    return (
      <EmptyState>{query ? 'No spare parts match the search.' : 'No spare parts yet.'}</EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChipFilter chips={chips} value={filter} onChange={setFilter} />
        {isEditing ? <AddComponentMenu onAdd={(t) => addComponent(t, SPARE)} /> : null}
      </div>

      {deviceGroups
        .filter((g) => showCat(g.cat.id))
        .map((g) => (
          <CategoryBlock
            key={g.cat.id}
            category={g.cat}
            items={g.items}
            deployment="spare"
            isEditing={isEditing}
            onChange={(mut) => updateCategory(g.cat.id, mut)}
            onDelete={() => deleteCategory(g.cat.id)}
            onOpenItem={onOpenItem}
            openItemId={openItemId}
          />
        ))}

      {compGroups
        .filter((g) => showType(g.type))
        .map((g) => (
          <SectionCard key={g.type} flush>
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              {iconOf(componentIcon(COMPONENT_TYPE_LABELS[g.type]) ?? Cpu)}
              <h3 className="font-display text-base text-foreground">
                {COMPONENT_TYPE_LABELS[g.type]}
              </h3>
              <Badge variant="secondary" className="font-mono tabular-nums">
                {pad2(g.items.length)}
              </Badge>
            </header>
            <ComponentTable
              items={g.items}
              isEditing={isEditing}
              onOpenItem={onOpenItem}
              openItemId={openItemId}
              onDelete={deleteComponent}
            />
          </SectionCard>
        ))}

      {isEditing && filter === 'all' ? (
        <button
          type="button"
          className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card/50 text-muted-foreground transition-colors hover:border-brand hover:text-brand"
          onClick={addCategory}
        >
          <Plus className="size-5" strokeWidth={1.75} />
          <span className="text-sm font-medium">New device category</span>
        </button>
      ) : null}
    </div>
  );
}

function ChipFilter({
  chips,
  value,
  onChange,
}: {
  chips: Chip[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (chips.length <= 1) return null;
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            value === c.id
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          {c.icon}
          {c.label}
          <span className="font-mono tabular-nums opacity-60">{c.count}</span>
        </button>
      ))}
    </nav>
  );
}

function AddComponentMenu({ onAdd }: { onAdd: (type: ComponentType) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Add</span>
      {TYPE_ORDER.map((t) => (
        <Button key={t} variant="outline" size="xs" onClick={() => onAdd(t)}>
          <Plus className="size-3" strokeWidth={2} /> {COMPONENT_TYPE_LABELS[t]}
        </Button>
      ))}
    </div>
  );
}
