import { Plus } from 'lucide-react';

import type { ComponentType, Inventory } from '../../lib/inventory';
import { roleIcon } from '../../lib/inventoryIcons';
import { Badge } from '@/components/ui/badge';

import { ComponentTable } from './ComponentTable';
import { ADD_ROW_BTN, EmptyState, matchComponent, pad2 } from './shared';

interface ServiceTabProps {
  inv: Inventory;
  isEditing: boolean;
  query: string;
  addComponent: (type: ComponentType, assignment: string) => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

export function ServiceTab({
  inv,
  isEditing,
  query,
  addComponent,
  onOpenItem,
  openItemId,
}: ServiceTabProps) {
  const sections = inv.machines
    .map((m) => ({
      machine: m,
      comps: inv.components.filter((c) => c.assignment === m.id && matchComponent(c, query)),
    }))
    .filter((s) => s.comps.length > 0 || isEditing);

  if (sections.length === 0) {
    return (
      <EmptyState>
        {query
          ? 'No in-service components match the search.'
          : 'No machines have installed components yet.'}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {sections.map(({ machine, comps }) => {
        const RoleIcon = roleIcon(machine.role, machine.name);
        return (
          <section
            key={machine.id}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
          >
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {machine.ids?.uid ?? machine.ordinal ?? '—'}
              </span>
              <span className="flex items-center gap-1.5">
                <RoleIcon size={14} strokeWidth={1.75} className="text-muted-foreground" />
                <span className="font-display text-base text-foreground">{machine.name}</span>
                <span className="text-sm text-muted-foreground">{machine.role}</span>
              </span>
              <Badge variant="secondary" className="ml-auto font-mono tabular-nums">
                {pad2(comps.length)} component{comps.length === 1 ? '' : 's'}
              </Badge>
            </header>
            <ComponentTable
              items={comps}
              isEditing={false}
              onOpenItem={onOpenItem}
              openItemId={openItemId}
            />
            {isEditing ? (
              <div className="border-t border-border px-4 py-2">
                <button
                  type="button"
                  className={ADD_ROW_BTN}
                  onClick={() => addComponent('other', machine.id)}
                >
                  <Plus size={12} strokeWidth={2} /> component
                </button>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
