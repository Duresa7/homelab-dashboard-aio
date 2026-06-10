import { X } from 'lucide-react';

import {
  genId,
  type Component,
  type FoundItem,
  type ItemDetail,
  type ItemIds,
  type ItemStatus,
  type Machine,
  type ProblemLogEntry,
  type PurchaseInfo,
  type Device,
} from '../lib/inventory';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { STATUS_KIND, today } from './inventory/detail/primitives';
import { StatusSelect } from './inventory/detail/StatusSelect';
import { ComponentHeader, DeviceHeader, MachineHeader } from './inventory/detail/headers';
import { ComponentSpecsSection, DeviceSpecsSection } from './inventory/detail/specs';
import { AssignmentSection, DeviceSection } from './inventory/detail/assignment';
import { ComponentsSection } from './inventory/detail/ComponentsSection';
import { ImagesSection } from './inventory/detail/ImagesSection';
import { ProblemLogSection } from './inventory/detail/ProblemLogSection';
import { ProvenanceSection } from './inventory/detail/ProvenanceSection';
import { IdentifiersSection } from './inventory/detail/IdentifiersSection';

type AnyItem = Machine | Device | Component;
type Mutator<T> = (mut: (cur: T) => T) => void;

interface Props {
  found: FoundItem;
  isEditing: boolean;
  /** All machines — for the component assignment selector + machine listing. */
  machines: Machine[];
  /** The full component pool — a machine pop-up lists the ones assigned to it. */
  components: Component[];
  onChange: (id: string, mut: (item: AnyItem) => AnyItem) => void;
  onClose: () => void;
}

const STRIPE_COLOR: Record<string, string> = {
  ok: 'var(--ok)',
  bad: 'var(--bad)',
  warn: 'var(--warn)',
  idle: 'var(--idle)',
};

export function InventoryDetailPanel({
  found,
  isEditing,
  machines,
  components,
  onChange,
  onClose,
}: Props) {
  const itemId =
    found.kind === 'machine'
      ? found.machine.id
      : found.kind === 'spare'
        ? found.item.id
        : found.component.id;
  const detail: ItemDetail =
    found.kind === 'machine'
      ? found.machine
      : found.kind === 'spare'
        ? found.item
        : found.component;
  const status: ItemStatus = detail.status ?? 'working';

  const mutDetail: Mutator<ItemDetail> = (mut) => {
    onChange(itemId, (cur) => ({ ...cur, ...mut(cur) }) as AnyItem);
  };

  const setStatus = (s: ItemStatus) => mutDetail((cur) => ({ ...cur, status: s }));

  const setPurchase = (patch: Partial<PurchaseInfo>) =>
    mutDetail((cur) => ({ ...cur, purchase: { ...(cur.purchase ?? {}), ...patch } }));

  const setIds = (patch: Partial<ItemIds>) =>
    mutDetail((cur) => ({ ...cur, ids: { ...(cur.ids ?? {}), ...patch } }));

  const addLogEntry = (note: string, date: string) => {
    if (!note.trim()) return;
    const entry: ProblemLogEntry = { id: genId('log'), date: date || today(), note: note.trim() };
    mutDetail((cur) => ({ ...cur, problemLog: [entry, ...(cur.problemLog ?? [])] }));
  };

  const removeLogEntry = (id: string) =>
    mutDetail((cur) => ({
      ...cur,
      problemLog: (cur.problemLog ?? []).filter((e) => e.id !== id),
    }));

  const updateLogEntry = (id: string, patch: Partial<Pick<ProblemLogEntry, 'date' | 'note'>>) =>
    mutDetail((cur) => ({
      ...cur,
      problemLog: (cur.problemLog ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));

  const purchase = detail.purchase ?? {};
  const ids = detail.ids ?? {};
  const log = detail.problemLog ?? [];
  const images = detail.images ?? [];
  const kindClass = STATUS_KIND[status];
  const itemLabel =
    found.kind === 'machine'
      ? found.machine.name
      : found.kind === 'spare'
        ? found.item.name || 'Device'
        : found.component.label;

  const setImages = (next: typeof images) => mutDetail((cur) => ({ ...cur, images: next }));

  const header =
    found.kind === 'machine' ? (
      <MachineHeader
        machine={found.machine}
        isEditing={isEditing}
        onChange={(mut) => onChange(itemId, mut as (m: AnyItem) => AnyItem)}
      />
    ) : found.kind === 'spare' ? (
      <DeviceHeader
        item={found.item}
        category={found.category}
        isEditing={isEditing}
        onChange={(mut) => onChange(itemId, mut as (m: AnyItem) => AnyItem)}
      />
    ) : (
      <ComponentHeader
        component={found.component}
        machine={found.machine}
        isEditing={isEditing}
        onChange={(mut) => onChange(itemId, mut as (m: AnyItem) => AnyItem)}
      />
    );

  const setComponent = (mut: (c: Component) => Component) =>
    onChange(itemId, (cur) => mut(cur as Component) as AnyItem);
  const setDevice = (mut: (it: Device) => Device) =>
    onChange(itemId, (cur) => mut(cur as Device) as AnyItem);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-label="Item details"
        className="flex max-h-[90vh] w-[92vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]"
      >
        <DialogTitle className="sr-only">Item details</DialogTitle>
        <DialogDescription className="sr-only">
          Specifications, identifiers, components and problem log for this inventory item.
        </DialogDescription>
        <div
          className="h-1 w-full shrink-0"
          aria-hidden
          style={{ background: STRIPE_COLOR[kindClass] ?? 'var(--ok)' }}
        />

        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
          {header}
          <div className="flex shrink-0 items-center gap-2">
            <StatusSelect status={status} onChange={setStatus} />
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                title="Close (Esc)"
              >
                <X size={16} strokeWidth={1.75} />
              </Button>
            </DialogClose>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-6 md:grid-cols-2">
          {found.kind === 'component' ? (
            <ComponentSpecsSection
              component={found.component}
              isEditing={isEditing}
              onChange={setComponent}
            />
          ) : null}
          {found.kind === 'spare' ? (
            <DeviceSpecsSection
              item={found.item}
              category={found.category}
              isEditing={isEditing}
              onChange={setDevice}
            />
          ) : null}

          {found.kind === 'component' ? (
            <AssignmentSection
              component={found.component}
              machines={machines}
              onChange={setComponent}
            />
          ) : null}

          {found.kind === 'spare' ? (
            <DeviceSection item={found.item} isEditing={isEditing} onChange={setDevice} />
          ) : null}

          <ProvenanceSection purchase={purchase} isEditing={isEditing} setPurchase={setPurchase} />

          <IdentifiersSection ids={ids} isEditing={isEditing} setIds={setIds} />

          {found.kind === 'machine' ? (
            <ComponentsSection machine={found.machine} components={components} />
          ) : null}

          <ImagesSection
            images={images}
            isEditing={isEditing}
            label={itemLabel}
            onChange={setImages}
          />

          <ProblemLogSection
            log={log}
            status={status}
            onAdd={addLogEntry}
            onUpdate={updateLogEntry}
            onRemove={removeLogEntry}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
