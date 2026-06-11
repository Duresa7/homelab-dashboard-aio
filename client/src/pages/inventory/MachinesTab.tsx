import { ChevronRight, Cpu, Plus, Trash2, X } from 'lucide-react';

import {
  componentTitle,
  genId,
  type Component,
  type ComponentType,
  type Inventory,
  type Machine,
} from '../../lib/inventory';
import { BrandGlyph, componentIcon, roleIcon } from '../../lib/inventoryIcons';
import { ListRow, SectionCard } from '@/components/common';
import { cn } from '@/lib/utils';

import { Editable } from './Editable';
import { ADD_ROW_BTN, EmptyState, GHOST_ICON_BTN, matchMachine, statusKind } from './shared';

const CARD_SPAN = 'col-span-12 sm:col-span-6 lg:col-span-4';

interface MachinesTabProps {
  inv: Inventory;
  isEditing: boolean;
  query: string;
  updateMachine: (id: string, mut: (m: Machine) => Machine) => void;
  deleteMachine: (id: string) => void;
  addMachine: () => void;
  addComponent: (type: ComponentType, assignment: string) => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

export function MachinesTab({
  inv,
  isEditing,
  query,
  updateMachine,
  deleteMachine,
  addMachine,
  addComponent,
  onOpenItem,
  openItemId,
}: MachinesTabProps) {
  const machines = inv.machines.filter((m) => matchMachine(m, query));
  if (machines.length === 0 && !isEditing) {
    return (
      <EmptyState>
        {query ? 'No machines match the current search.' : 'No machines on file yet.'}
      </EmptyState>
    );
  }
  return (
    <div className="grid grid-cols-12 gap-4">
      {machines.map((m) => {
        const comps = inv.components.filter((c) => c.assignment === m.id);
        return isEditing ? (
          <MachineCard
            key={m.id}
            machine={m}
            components={comps}
            isEditing
            onChange={(mut) => updateMachine(m.id, mut)}
            onDelete={() => deleteMachine(m.id)}
            onAddComponent={() => addComponent('other', m.id)}
            onOpen={() => onOpenItem(m.id)}
            onOpenComponent={onOpenItem}
            isOpen={openItemId === m.id}
          />
        ) : (
          <MachineBrowseCard
            key={m.id}
            machine={m}
            components={comps}
            onOpen={() => onOpenItem(m.id)}
            onOpenComponent={onOpenItem}
            isOpen={openItemId === m.id}
          />
        );
      })}
      {isEditing ? (
        <button
          type="button"
          className={cn(
            CARD_SPAN,
            'flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card/50 text-muted-foreground transition-colors hover:border-brand hover:text-brand',
          )}
          onClick={addMachine}
        >
          <Plus className="size-5" strokeWidth={1.75} />
          <span className="text-sm font-medium">New machine</span>
        </button>
      ) : null}
    </div>
  );
}

function MachineBrowseCard({
  machine,
  components,
  onOpen,
  onOpenComponent,
  isOpen,
}: {
  machine: Machine;
  components: Component[];
  onOpen: () => void;
  onOpenComponent: (id: string) => void;
  isOpen: boolean;
}) {
  const m = machine;
  const RoleIcon = roleIcon(m.role, m.name);
  return (
    <SectionCard flush span={4} className={cn(isOpen && 'ring-2 ring-brand/50')}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${m.name} details`}
        className="group flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <div className="flex shrink-0 flex-col items-start leading-none">
          <span className="font-display text-2xl font-semibold tabular-nums text-brand">
            {m.ordinal ?? '—'}
          </span>
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {m.ids?.uid ?? 'machine'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: `var(--${statusKind(m.status ?? 'working')})` }}
              aria-hidden
            />
            <span className="truncate font-display text-base font-semibold text-foreground">
              {m.name}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <RoleIcon size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{m.role}</span>
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </button>

      {m.meta.length > 0 ? (
        <dl className="flex flex-col gap-1 border-t border-border/60 px-4 py-3">
          {m.meta.map((row) => (
            <div className="grid grid-cols-[110px_1fr] items-center gap-2" key={row.id}>
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 truncate font-mono text-sm text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex flex-col border-t border-border/60 px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Cpu size={12} strokeWidth={1.75} />
          <span>Components</span>
          <span className="ml-auto font-mono tabular-nums">{components.length}</span>
        </div>
        {components.length === 0 ? (
          <p className="py-1.5 text-sm text-muted-foreground">No components assigned.</p>
        ) : (
          components.map((c) => (
            <ListRow
              key={c.id}
              dot={statusKind(c.status ?? 'working')}
              name={c.label}
              meta={componentTitle(c)}
              value={<span className="font-mono text-[var(--ink-4)]">{c.ids?.uid ?? '—'}</span>}
              onClick={() => onOpenComponent(c.id)}
            />
          ))
        )}
      </div>
    </SectionCard>
  );
}

interface MachineCardProps {
  machine: Machine;
  components: Component[];
  isEditing: boolean;
  onChange: (mut: (m: Machine) => Machine) => void;
  onDelete: () => void;
  onAddComponent: () => void;
  onOpen: () => void;
  onOpenComponent: (id: string) => void;
  isOpen: boolean;
}

function MachineCard({
  machine,
  components,
  isEditing,
  onChange,
  onDelete,
  onAddComponent,
  onOpen,
  onOpenComponent,
  isOpen,
}: MachineCardProps) {
  const m = machine;
  const RoleIcon = roleIcon(m.role, m.name);

  const setField = (key: 'name' | 'role' | 'ordinal', v: string) =>
    onChange((cur) => ({ ...cur, [key]: v }));
  const updateMeta = (id: string, key: 'label' | 'value', v: string) =>
    onChange((cur) => ({
      ...cur,
      meta: cur.meta.map((row) => (row.id === id ? { ...row, [key]: v } : row)),
    }));
  const addMeta = () =>
    onChange((cur) => ({
      ...cur,
      meta: [...cur.meta, { id: genId('m'), label: 'Label', value: '' }],
    }));
  const removeMeta = (id: string) =>
    onChange((cur) => ({ ...cur, meta: cur.meta.filter((r) => r.id !== id) }));

  const openOnClick = (e: React.MouseEvent<HTMLElement>) => {
    if (
      (e.target as HTMLElement).closest(
        'input, textarea, button, a, [contenteditable="true"], [data-row]',
      )
    )
      return;
    onOpen();
  };
  const openOnKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (
      (e.key === 'Enter' || e.key === ' ') &&
      !(e.target as HTMLElement).closest('input, textarea, button')
    ) {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <article
      className={cn(
        CARD_SPAN,
        'group flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-card-hover',
        isOpen && 'ring-2 ring-brand/50',
      )}
      onClick={openOnClick}
      onKeyDown={openOnKey}
      tabIndex={0}
      role="button"
      aria-label={`Open ${m.name} details`}
    >
      <header className="flex items-start gap-3">
        <div className="flex shrink-0 flex-col items-start leading-none">
          <Editable
            value={m.ordinal ?? ''}
            editing={isEditing}
            onChange={(v) => setField('ordinal', v)}
            placeholder="##"
            className="w-14 font-display text-2xl font-semibold tabular-nums text-brand"
            maxLength={4}
          />
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {m.ids?.uid ?? 'machine'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <Editable
            value={m.name}
            editing={isEditing}
            onChange={(v) => setField('name', v)}
            placeholder="Machine name"
            className="font-display text-base font-semibold text-foreground"
          />
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <RoleIcon size={12} strokeWidth={1.75} className="shrink-0" />
            <Editable
              value={m.role}
              editing={isEditing}
              onChange={(v) => setField('role', v)}
              placeholder="Role"
              className="text-sm text-muted-foreground"
            />
          </div>
        </div>
        {isEditing ? (
          <button
            type="button"
            className={GHOST_ICON_BTN}
            onClick={onDelete}
            title="Delete machine"
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      {m.meta.length > 0 || isEditing ? (
        <dl className="flex flex-col gap-1 border-t border-border/60 pt-3">
          {m.meta.map((row) => (
            <div className="grid grid-cols-[110px_1fr_auto] items-center gap-2" key={row.id}>
              <dt className="text-xs text-muted-foreground">
                <Editable
                  value={row.label}
                  editing={isEditing}
                  onChange={(v) => updateMeta(row.id, 'label', v)}
                  placeholder="Label"
                  className="text-xs text-muted-foreground"
                />
              </dt>
              <dd className="min-w-0 text-sm text-foreground">
                <Editable
                  value={row.value}
                  editing={isEditing}
                  onChange={(v) => updateMeta(row.id, 'value', v)}
                  placeholder="Value"
                  mono
                  className="text-sm"
                />
              </dd>
              {isEditing ? (
                <button
                  type="button"
                  className={GHOST_ICON_BTN}
                  onClick={() => removeMeta(row.id)}
                  title="Remove meta row"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              ) : null}
            </div>
          ))}
          {isEditing ? (
            <button type="button" className={ADD_ROW_BTN} onClick={addMeta}>
              <Plus size={12} strokeWidth={2} /> meta row
            </button>
          ) : null}
        </dl>
      ) : null}

      <section className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Cpu size={12} strokeWidth={1.75} />
          <span>Components</span>
          <span className="ml-auto font-mono tabular-nums">{components.length}</span>
        </div>
        <ul className="flex flex-col divide-y divide-border/60">
          {components.map((c) => {
            const CompIcon = componentIcon(c.label) ?? Cpu;
            return (
              <li
                key={c.id}
                data-row
                className="grid cursor-pointer grid-cols-[110px_1fr] items-center gap-2 rounded py-1.5 hover:bg-muted/40"
                onClick={() => onOpenComponent(c.id)}
              >
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CompIcon size={12} strokeWidth={1.75} className="shrink-0" />
                  <span className="truncate">{c.label}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                  <BrandGlyph text={componentTitle(c)} size={16} reserveSpace />
                  <span className="truncate">{componentTitle(c)}</span>
                </span>
              </li>
            );
          })}
          {components.length === 0 ? (
            <li className="py-1.5 text-sm text-muted-foreground">No components assigned.</li>
          ) : null}
        </ul>
        {isEditing ? (
          <button type="button" className={ADD_ROW_BTN} onClick={onAddComponent}>
            <Plus size={12} strokeWidth={2} /> component
          </button>
        ) : null}
      </section>
    </article>
  );
}
