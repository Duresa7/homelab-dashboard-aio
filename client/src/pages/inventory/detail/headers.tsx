import { Cpu } from 'lucide-react';

import {
  componentTitle,
  type Component,
  type Machine,
  type DeviceCategory,
  type Device,
} from '../../../lib/inventory';
import { BrandGlyph, categoryIcon, componentIcon, roleIcon } from '../../../lib/inventoryIcons';

import { Editable } from '../Editable';

export function MachineHeader({
  machine,
  isEditing,
  onChange,
}: {
  machine: Machine;
  isEditing: boolean;
  onChange: (mut: (m: Machine) => Machine) => void;
}) {
  const RoleIcon = roleIcon(machine.role, machine.name);
  return (
    <div className="flex min-w-0 items-center gap-4">
      <div className="flex w-14 shrink-0 flex-col items-center">
        <span className="font-display text-2xl font-semibold tabular-nums leading-none text-brand">
          {machine.ordinal ?? '—'}
        </span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          machine
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="truncate font-display text-xl font-semibold tracking-tight text-foreground">
          <Editable
            value={machine.name}
            editing={isEditing}
            onChange={(name) => onChange((cur) => ({ ...cur, name }))}
            placeholder="Machine name"
          />
        </h2>
        <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <RoleIcon size={13} strokeWidth={1.75} />
          <Editable
            value={machine.role}
            editing={isEditing}
            onChange={(role) => onChange((cur) => ({ ...cur, role }))}
            placeholder="Role / purpose"
          />
          <span className="text-muted-foreground/50">·</span>
          <span className="font-mono text-xs">{machine.ids?.uid ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}

export function DeviceHeader({
  item,
  category,
  isEditing,
  onChange,
}: {
  item: Device;
  category: DeviceCategory;
  isEditing: boolean;
  onChange: (mut: (it: Device) => Device) => void;
}) {
  const CatIcon = categoryIcon(category.name);
  const title = describeDevice(item, category);
  const brand = item.values.brand ?? '';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="uppercase tracking-wider">device</span>
        <span className="text-muted-foreground/50">·</span>
        <CatIcon size={13} strokeWidth={1.75} />
        <span>{category.name}</span>
        {item.ids?.uid ? (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="font-mono">{item.ids.uid}</span>
          </>
        ) : null}
      </div>
      <h2 className="flex min-w-0 items-center gap-2 font-display text-xl font-semibold tracking-tight text-foreground">
        {brand ? <BrandGlyph text={brand} size={18} /> : null}
        {isEditing ? (
          <Editable
            value={item.name ?? ''}
            editing
            onChange={(name) => onChange((cur) => ({ ...cur, name: name || undefined }))}
            placeholder={title}
          />
        ) : (
          <span className="truncate">{title}</span>
        )}
      </h2>
    </div>
  );
}

export function ComponentHeader({
  component,
  machine,
  isEditing,
  onChange,
}: {
  component: Component;
  machine: Machine | null;
  isEditing: boolean;
  onChange: (mut: (c: Component) => Component) => void;
}) {
  const CompIcon = componentIcon(component.label) ?? Cpu;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="uppercase tracking-wider">component</span>
        <span className="text-muted-foreground/50">·</span>
        <CompIcon size={13} strokeWidth={1.75} />
        {isEditing ? (
          <Editable
            value={component.label}
            editing
            onChange={(label) => onChange((cur) => ({ ...cur, label }))}
            placeholder="Label"
            className="text-xs"
          />
        ) : (
          <span>{component.label}</span>
        )}
        {component.ids?.uid ? (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="font-mono">{component.ids.uid}</span>
          </>
        ) : null}
      </div>
      <h2 className="flex min-w-0 items-center gap-2 font-display text-xl font-semibold tracking-tight text-foreground">
        <BrandGlyph text={componentTitle(component)} size={18} />
        <span className="truncate">{componentTitle(component)}</span>
      </h2>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          {machine ? 'installed in' : 'status'}
        </span>
        <span>{machine ? machine.name : 'Spare — not installed'}</span>
      </div>
    </div>
  );
}

function describeDevice(item: Device, category: DeviceCategory): string {
  if (item.name?.trim()) return item.name.trim();
  const brand = item.values.brand?.trim();
  const model = item.values.model?.trim() || item.values.part?.trim();
  if (brand && model) return `${brand} ${model}`;
  if (model) return model;
  if (brand) return brand;
  return `${category.name.replace(/s$/, '')} item`;
}
