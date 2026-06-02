import { useEffect, useState } from 'react';
import {
  Boxes,
  Briefcase,
  Calendar,
  CheckCircle2,
  CircleSlash,
  Cpu,
  Fingerprint,
  Hash,
  MapPin,
  Plus,
  Receipt,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Wifi,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

import {
  COMPONENT_TYPE_LABELS,
  componentTitle,
  genId,
  SPARE,
  type Component,
  type ComponentType,
  type Deployment,
  type FoundItem,
  type ItemDetail,
  type ItemIds,
  type ItemStatus,
  type Machine,
  type ProblemLogEntry,
  type PurchaseInfo,
  type SpareCategory,
  type SpareItem,
  type SpecField,
} from '../lib/inventory';
import { BrandGlyph, categoryIcon, componentIcon, roleIcon } from '../lib/inventoryIcons';
import { Editable } from './InventoryPage';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type AnyItem = Machine | SpareItem | Component;
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

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'working',   label: 'working' },
  { value: 'broken',    label: 'broken' },
  { value: 'in-repair', label: 'in-repair' },
  { value: 'retired',   label: 'retired' },
];

const STRIPE_COLOR: Record<string, string> = {
  ok: 'var(--ok)',
  bad: 'var(--bad)',
  warn: 'var(--warn)',
  idle: 'var(--idle)',
};

const STATUS_ICON: Record<ItemStatus, LucideIcon> = {
  working:     CheckCircle2,
  broken:      CircleSlash,
  'in-repair': Wrench,
  retired:     Tag,
};

const STATUS_KIND: Record<ItemStatus, 'ok' | 'bad' | 'warn' | 'idle'> = {
  working:     'ok',
  broken:      'bad',
  'in-repair': 'warn',
  retired:     'idle',
};

const TONE_TEXT: Record<'ok' | 'bad' | 'warn' | 'idle', string> = {
  ok: 'text-ok',
  bad: 'text-bad',
  warn: 'text-warn',
  idle: 'text-idle',
};

export function InventoryDetailPanel({ found, isEditing, machines, components, onChange, onClose }: Props) {
  const itemId =
    found.kind === 'machine'   ? found.machine.id
    : found.kind === 'spare'   ? found.item.id
    :                            found.component.id;
  const detail: ItemDetail =
    found.kind === 'machine'   ? found.machine
    : found.kind === 'spare'   ? found.item
    :                            found.component;
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
  const kindClass = STATUS_KIND[status];

  const header =
    found.kind === 'machine'
      ? <MachineHeader machine={found.machine} isEditing={isEditing} onChange={(mut) => onChange(itemId, mut as (m: AnyItem) => AnyItem)} />
    : found.kind === 'spare'
      ? <SpareHeader item={found.item} category={found.category} isEditing={isEditing} onChange={(mut) => onChange(itemId, mut as (m: AnyItem) => AnyItem)} />
      : <ComponentHeader component={found.component} machine={found.machine} isEditing={isEditing} onChange={(mut) => onChange(itemId, mut as (m: AnyItem) => AnyItem)} />;

  // Sections collapse to only their filled fields when browsing; the full form
  // reveals in edit mode (so empty MAC/serial/etc. don't clutter at-a-glance).
  const hasPurchase = !!(purchase.date || purchase.vendor || purchase.price || purchase.receiptRef || purchase.warrantyEnd);
  const hasIds = !!(ids.serial || ids.part || ids.uid || ids.mac || ids.assetTag || ids.location);

  const setComponent = (mut: (c: Component) => Component) =>
    onChange(itemId, (cur) => mut(cur as Component) as AnyItem);
  const setSpare = (mut: (it: SpareItem) => SpareItem) =>
    onChange(itemId, (cur) => mut(cur as SpareItem) as AnyItem);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label="Item details"
        className="flex max-h-[90vh] w-[92vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]"
      >
        <DialogTitle className="sr-only">Item details</DialogTitle>
        <DialogDescription className="sr-only">Specifications, identifiers, components and problem log for this inventory item.</DialogDescription>
        <div className="h-1 w-full shrink-0" aria-hidden style={{ background: STRIPE_COLOR[kindClass] ?? 'var(--ok)' }} />

        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
          {header}
          <div className="flex shrink-0 items-center gap-2">
            <StatusSelect status={status} onChange={setStatus} />
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="Close (Esc)">
                <X size={16} strokeWidth={1.75} />
              </Button>
            </DialogClose>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-6 md:grid-cols-2">
          {found.kind === 'component' ? (
            <ComponentSpecsSection component={found.component} isEditing={isEditing} onChange={setComponent} />
          ) : null}
          {found.kind === 'spare' ? (
            <SpareSpecsSection item={found.item} category={found.category} isEditing={isEditing} onChange={setSpare} />
          ) : null}

          {found.kind === 'component' ? (
            <AssignmentSection component={found.component} machines={machines} onChange={setComponent} />
          ) : null}

          {found.kind === 'spare' ? (
            <DeviceSection item={found.item} isEditing={isEditing} onChange={setSpare} />
          ) : null}

          {(isEditing || hasPurchase) && (
            <Section icon={Receipt} title="Provenance">
              <DetailField label="Purchased" icon={Calendar} value={purchase.date} editing={isEditing} mono
                input={<DateInput value={purchase.date} onChange={(v) => setPurchase({ date: v })} />} />
              <DetailField label="Vendor" icon={Briefcase} value={purchase.vendor} editing={isEditing}
                input={<TextInput value={purchase.vendor} onChange={(v) => setPurchase({ vendor: v })} placeholder="Where you bought it" />} />
              <DetailField label="Price" icon={Tag} value={purchase.price} editing={isEditing} mono
                input={<TextInput value={purchase.price} onChange={(v) => setPurchase({ price: v })} placeholder="$0.00" mono />} />
              <DetailField label="Receipt #" icon={Hash} value={purchase.receiptRef} editing={isEditing} mono
                input={<TextInput value={purchase.receiptRef} onChange={(v) => setPurchase({ receiptRef: v })} placeholder="Order or receipt reference" mono />} />
              <DetailField label="Warranty" icon={ShieldCheck} value={purchase.warrantyEnd} editing={isEditing} mono
                input={<DateInput value={purchase.warrantyEnd} onChange={(v) => setPurchase({ warrantyEnd: v })} hint={warrantyHint(purchase.warrantyEnd)} />} />
            </Section>
          )}

          {(isEditing || hasIds) && (
            <Section icon={Fingerprint} title="Identifiers">
              <DetailField label="UID" icon={Sparkles} value={ids.uid} editing={isEditing} mono
                input={<TextInput value={ids.uid} onChange={(v) => setIds({ uid: v })} placeholder="Auto-assigned" mono />} />
              <DetailField label="Serial #" icon={Hash} value={ids.serial} editing={isEditing} mono
                input={<TextInput value={ids.serial} onChange={(v) => setIds({ serial: v })} placeholder="Manufacturer serial" mono />} />
              <DetailField label="Part #" icon={Hash} value={ids.part} editing={isEditing} mono
                input={<TextInput value={ids.part} onChange={(v) => setIds({ part: v })} placeholder="Manufacturer part / model config" mono />} />
              <DetailField label="MAC" icon={Wifi} value={ids.mac} editing={isEditing} mono
                input={<TextInput value={ids.mac} onChange={(v) => setIds({ mac: v })} placeholder="AA:BB:CC:DD:EE:FF" mono />} />
              <DetailField label="Asset tag" icon={Tag} value={ids.assetTag} editing={isEditing} mono
                input={<TextInput value={ids.assetTag} onChange={(v) => setIds({ assetTag: v })} placeholder="Internal asset tag" mono />} />
              <DetailField label="Location" icon={MapPin} value={ids.location} editing={isEditing}
                input={<TextInput value={ids.location} onChange={(v) => setIds({ location: v })} placeholder="Office · rack · shelf" />} />
            </Section>
          )}

          {found.kind === 'machine' ? (
            <ComponentsSection machine={found.machine} components={components} />
          ) : null}

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

/* ------------------------------------------------------------------ */
/* Header variants                                                    */
/* ------------------------------------------------------------------ */

function MachineHeader({
  machine, isEditing, onChange,
}: { machine: Machine; isEditing: boolean; onChange: (mut: (m: Machine) => Machine) => void }) {
  const RoleIcon = roleIcon(machine.role, machine.name);
  return (
    <div className="flex min-w-0 items-center gap-4">
      <div className="flex w-14 shrink-0 flex-col items-center">
        <span className="font-display text-2xl font-semibold tabular-nums leading-none text-brand">{machine.ordinal ?? '—'}</span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">machine</span>
      </div>
      <div className="min-w-0">
        <h2 className="truncate font-display text-xl font-semibold tracking-tight text-foreground">
          <Editable value={machine.name} editing={isEditing} onChange={(name) => onChange((cur) => ({ ...cur, name }))} placeholder="Machine name" />
        </h2>
        <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <RoleIcon size={13} strokeWidth={1.75} />
          <Editable value={machine.role} editing={isEditing} onChange={(role) => onChange((cur) => ({ ...cur, role }))} placeholder="Role / purpose" />
          <span className="text-muted-foreground/50">·</span>
          <span className="font-mono text-xs">{machine.ids?.uid ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}

function SpareHeader({
  item, category, isEditing, onChange,
}: { item: SpareItem; category: SpareCategory; isEditing: boolean; onChange: (mut: (it: SpareItem) => SpareItem) => void }) {
  const CatIcon = categoryIcon(category.name);
  const title = describeSpare(item, category);
  const brand = item.values.brand ?? '';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="uppercase tracking-wider">device</span>
        <span className="text-muted-foreground/50">·</span>
        <CatIcon size={13} strokeWidth={1.75} />
        <span>{category.name}</span>
        {item.ids?.uid ? <><span className="text-muted-foreground/50">·</span><span className="font-mono">{item.ids.uid}</span></> : null}
      </div>
      <h2 className="flex min-w-0 items-center gap-2 font-display text-xl font-semibold tracking-tight text-foreground">
        {brand ? <BrandGlyph text={brand} size={18} /> : null}
        {isEditing ? (
          <Editable value={item.name ?? ''} editing onChange={(name) => onChange((cur) => ({ ...cur, name: name || undefined }))} placeholder={title} />
        ) : (
          <span className="truncate">{title}</span>
        )}
      </h2>
    </div>
  );
}

function ComponentHeader({
  component, machine, isEditing, onChange,
}: { component: Component; machine: Machine | null; isEditing: boolean; onChange: (mut: (c: Component) => Component) => void }) {
  const CompIcon = componentIcon(component.label) ?? Cpu;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="uppercase tracking-wider">component</span>
        <span className="text-muted-foreground/50">·</span>
        <CompIcon size={13} strokeWidth={1.75} />
        {isEditing ? (
          <Editable value={component.label} editing onChange={(label) => onChange((cur) => ({ ...cur, label }))} placeholder="Label" className="text-xs" />
        ) : (
          <span>{component.label}</span>
        )}
        {component.ids?.uid ? <><span className="text-muted-foreground/50">·</span><span className="font-mono">{component.ids.uid}</span></> : null}
      </div>
      <h2 className="flex min-w-0 items-center gap-2 font-display text-xl font-semibold tracking-tight text-foreground">
        <BrandGlyph text={componentTitle(component)} size={18} />
        <span className="truncate">{componentTitle(component)}</span>
      </h2>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">{machine ? 'installed in' : 'status'}</span>
        <span>{machine ? machine.name : 'Spare — not installed'}</span>
      </div>
    </div>
  );
}

function describeSpare(item: SpareItem, category: SpareCategory): string {
  if (item.name?.trim()) return item.name.trim();
  const brand = item.values.brand?.trim();
  const model = item.values.model?.trim() || item.values.part?.trim();
  if (brand && model) return `${brand} ${model}`;
  if (model) return model;
  if (brand) return brand;
  return `${category.name.replace(/s$/, '')} item`;
}

/* ------------------------------------------------------------------ */
/* Specifications                                                     */
/* ------------------------------------------------------------------ */

const TYPE_OPTIONS = Object.entries(COMPONENT_TYPE_LABELS) as [ComponentType, string][];

function ComponentSpecsSection({
  component, isEditing, onChange,
}: { component: Component; isEditing: boolean; onChange: (mut: (c: Component) => Component) => void }) {
  const setField = (fid: string, key: 'label' | 'value', v: string) =>
    onChange((cur) => ({ ...cur, fields: cur.fields.map((f) => (f.id === fid ? { ...f, [key]: v } : f)) }));
  const addField = () =>
    onChange((cur) => ({ ...cur, fields: [...cur.fields, { id: genId('f'), label: 'Label', value: '' }] }));
  const removeField = (fid: string) =>
    onChange((cur) => ({ ...cur, fields: cur.fields.filter((f) => f.id !== fid) }));
  const setType = (t: ComponentType) => onChange((cur) => ({ ...cur, type: t }));

  const visible: SpecField[] = isEditing
    ? component.fields
    : component.fields.filter((f) => f.value && f.value.trim());

  return (
    <Section icon={Settings2} title="Specifications">
      {isEditing ? (
        <Field label="Type">
          <Select value={component.type} onValueChange={(v) => setType(v as ComponentType)}>
            <SelectTrigger size="sm" className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {visible.map((f) =>
        isEditing ? (
          <div key={f.id} className="grid grid-cols-[104px_1fr_auto] items-center gap-2">
            <Input className="h-8 text-xs" value={f.label} onChange={(e) => setField(f.id, 'label', e.target.value)} placeholder="Label" />
            <Input className="h-8" value={f.value} onChange={(e) => setField(f.id, 'value', e.target.value)} placeholder="Value" />
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-bad" onClick={() => removeField(f.id)} title="Remove field">
              <X size={13} strokeWidth={2} />
            </Button>
          </div>
        ) : (
          <Field key={f.id} label={f.label}>
            <span className="text-sm text-foreground">{f.value}</span>
          </Field>
        ),
      )}

      {isEditing ? (
        <button type="button" className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-brand" onClick={addField}>
          <Plus size={12} strokeWidth={2} /> field
        </button>
      ) : null}
      {!isEditing && visible.length === 0 ? <span className="text-sm text-muted-foreground">No specs recorded.</span> : null}
    </Section>
  );
}

function SpareSpecsSection({
  item, category, isEditing, onChange,
}: { item: SpareItem; category: SpareCategory; isEditing: boolean; onChange: (mut: (it: SpareItem) => SpareItem) => void }) {
  const onValue = (colId: string, v: string) =>
    onChange((cur) => ({ ...cur, values: { ...cur.values, [colId]: v } }));
  const cols = category.columns.filter((c) => isEditing || (item.values[c.id] && item.values[c.id].trim()));
  if (cols.length === 0) return null;
  return (
    <Section icon={Settings2} title="Specifications">
      {cols.map((col) => {
        const isFeatures = /^notes$/i.test(col.id) || /^notes$/i.test(col.label);
        const label = isFeatures ? 'Features' : col.label;
        return (
          <Field key={col.id} label={label}>
            {isEditing ? (
              <TextInput value={item.values[col.id]} onChange={(v) => onValue(col.id, v)} placeholder={label} />
            ) : (
              <span className="text-sm text-foreground">{item.values[col.id]}</span>
            )}
          </Field>
        );
      })}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment (components) + Deployment (devices)                     */
/* ------------------------------------------------------------------ */

function AssignmentSection({
  component, machines, onChange,
}: { component: Component; machines: Machine[]; onChange: (mut: (c: Component) => Component) => void }) {
  return (
    <Section icon={MapPin} title="Assignment">
      <Field label="Installed in">
        <Select value={component.assignment} onValueChange={(v) => onChange((cur) => ({ ...cur, assignment: v }))}>
          <SelectTrigger size="sm" className="h-8 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SPARE}>Spare — not installed</SelectItem>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}{m.ids?.uid ? ` (${m.ids.uid})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </Section>
  );
}

const DEPLOYMENT_OPTIONS: { value: Deployment; label: string }[] = [
  { value: 'in-service', label: 'In service' },
  { value: 'spare',      label: 'Spare' },
];

function DeploymentSelect({ value, onChange }: { value: Deployment; onChange: (v: Deployment) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Deployment)}>
      <SelectTrigger size="sm" className="h-8 w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {DEPLOYMENT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeviceSection({
  item, isEditing, onChange,
}: { item: SpareItem; isEditing: boolean; onChange: (mut: (it: SpareItem) => SpareItem) => void }) {
  return (
    <Section icon={Tag} title="Placement">
      {isEditing ? (
        <Field label="Name">
          <TextInput value={item.name} onChange={(v) => onChange((cur) => ({ ...cur, name: v || undefined }))} placeholder="Friendly name (optional)" />
        </Field>
      ) : item.name ? (
        <Field label="Name"><span className="text-sm text-foreground">{item.name}</span></Field>
      ) : null}
      <Field label="Deployment">
        <DeploymentSelect value={item.deployment ?? 'spare'} onChange={(v) => onChange((cur) => ({ ...cur, deployment: v }))} />
      </Field>
    </Section>
  );
}

function DetailField({
  label, icon, value, editing, input, mono,
}: { label: string; icon?: LucideIcon; value?: string; editing: boolean; input: React.ReactNode; mono?: boolean }) {
  if (editing) return <Field label={label} icon={icon}>{input}</Field>;
  if (!value || !value.trim()) return null;
  return (
    <Field label={label} icon={icon}>
      <span className={cn('text-sm text-foreground', mono && 'font-mono text-[13px]')}>{value}</span>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Status select (shadcn)                                             */
/* ------------------------------------------------------------------ */

function StatusSelect({ status, onChange }: { status: ItemStatus; onChange: (s: ItemStatus) => void }) {
  const kind = STATUS_KIND[status];
  const Glyph = STATUS_ICON[status];
  return (
    <Select value={status} onValueChange={(v) => onChange(v as ItemStatus)}>
      <SelectTrigger
        size="sm"
        aria-label="Change status"
        className={cn('h-8 w-auto gap-1.5 rounded-full border-border bg-muted/50 px-3 text-xs font-medium lowercase', TONE_TEXT[kind])}
      >
        <Glyph size={13} strokeWidth={2} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((o) => {
          const OptGlyph = STATUS_ICON[o.value];
          return (
            <SelectItem key={o.value} value={o.value}>
              <span className={cn('flex items-center gap-1.5', TONE_TEXT[STATUS_KIND[o.value]])}>
                <OptGlyph size={13} strokeWidth={2} />
                {o.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ */
/* Section + Field building blocks                                    */
/* ------------------------------------------------------------------ */

function Section({
  icon: Icon,
  title,
  count,
  accent,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  accent?: 'bad' | 'warn';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-border bg-muted/30 p-4',
        accent === 'bad' && 'border-l-2 border-l-bad',
        accent === 'warn' && 'border-l-2 border-l-warn',
        className,
      )}
    >
      <h3 className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold tracking-wide text-muted-foreground">
        <Icon size={14} strokeWidth={1.75} />
        <span>{title}</span>
        {count != null ? <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{count}</span> : null}
      </h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-center gap-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon size={12} strokeWidth={1.75} /> : null}
        <span>{label}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
/* ------------------------------------------------------------------ */

function TextInput({
  value, onChange, placeholder, mono,
}: { value?: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  const [draft, setDraft] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value ?? '');
  }, [value, focused]);
  return (
    <Input
      type="text"
      className={cn('h-8', mono && 'font-mono text-[13px]')}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (draft !== (value ?? '')) onChange(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function DateInput({
  value, onChange, hint,
}: { value?: string; onChange: (v: string) => void; hint?: { text: string; kind: 'ok' | 'warn' | 'bad' | 'idle' } | null }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        className="h-8 w-auto font-mono text-[13px]"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className={cn('text-xs', TONE_TEXT[hint.kind])}>{hint.text}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Components (machines only)                                         */
/* ------------------------------------------------------------------ */

function ComponentsSection({ machine, components }: { machine: Machine; components: Component[] }) {
  const installed = components.filter((c) => c.assignment === machine.id);
  return (
    <Section icon={Boxes} title="Components" count={installed.length} className="md:col-span-2">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {installed.map((c) => {
          const CompIcon = componentIcon(c.label) ?? Cpu;
          return (
            <div key={c.id} className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2">
              <span className="flex w-24 shrink-0 items-center gap-1.5 pt-0.5 text-xs font-medium text-muted-foreground">
                <CompIcon size={12} strokeWidth={1.75} />
                <span className="truncate">{c.label}</span>
              </span>
              <BrandGlyph text={componentTitle(c)} size={14} reserveSpace />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">{componentTitle(c)}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{c.ids?.uid ?? ''}</div>
              </div>
            </div>
          );
        })}
        {installed.length === 0 ? (
          <span className="text-sm text-muted-foreground">No components assigned to this machine.</span>
        ) : null}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Problem log                                                        */
/* ------------------------------------------------------------------ */

interface ProblemLogProps {
  log: ProblemLogEntry[];
  status: ItemStatus;
  onAdd: (note: string, date: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<ProblemLogEntry, 'date' | 'note'>>) => void;
  onRemove: (id: string) => void;
}

function ProblemLogSection({ log, status, onAdd, onUpdate, onRemove }: ProblemLogProps) {
  const allowAdd = status === 'broken' || status === 'in-repair';
  if (!allowAdd && log.length === 0) return null;

  const accent = status === 'broken' ? 'bad' : status === 'in-repair' ? 'warn' : undefined;

  return (
    <Section icon={Wrench} title="Problem log" count={log.length} accent={accent} className="md:col-span-2">
      <ul className="flex flex-col gap-2">
        {log.length === 0 ? (
          <li className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            No entries yet — describe the issue below.
          </li>
        ) : null}
        {log.map((entry) => (
          <li key={entry.id} className="flex items-start gap-2 rounded-md border border-border/60 bg-card p-2">
            <Input
              type="date"
              className="h-8 w-auto shrink-0 font-mono text-[13px]"
              value={entry.date}
              onChange={(e) => onUpdate(entry.id, { date: e.target.value })}
            />
            <textarea
              className="min-h-8 flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={entry.note}
              rows={2}
              onChange={(e) => onUpdate(entry.id, { note: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-bad"
              onClick={() => onRemove(entry.id)}
              title="Remove entry"
            >
              <X size={13} strokeWidth={2} />
            </Button>
          </li>
        ))}
      </ul>
      {allowAdd ? <AddLogEntry onAdd={onAdd} /> : null}
    </Section>
  );
}

function AddLogEntry({ onAdd }: { onAdd: (note: string, date: string) => void }) {
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const submit = () => {
    if (!note.trim()) return;
    onAdd(note, date);
    setNote('');
    setDate(today());
  };
  return (
    <div className="mt-1 flex items-start gap-2 rounded-md border border-dashed border-border p-2">
      <Input
        type="date"
        className="h-8 w-auto shrink-0 font-mono text-[13px]"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <textarea
        className="min-h-8 flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        placeholder="Symptoms, repair notes, next steps…"
        value={note}
        rows={2}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button type="button" size="sm" className="shrink-0 gap-1" onClick={submit} disabled={!note.trim()} title="Add entry (Ctrl/Cmd+Enter)">
        <Plus size={13} strokeWidth={2} /> log
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function warrantyHint(warrantyEnd?: string): { text: string; kind: 'ok' | 'warn' | 'bad' | 'idle' } | null {
  if (!warrantyEnd) return null;
  const end = Date.parse(warrantyEnd);
  if (Number.isNaN(end)) return null;
  const now = Date.now();
  const days = Math.round((end - now) / 86_400_000);
  if (days < 0)  return { text: `expired ${Math.abs(days)}d ago`, kind: 'bad' };
  if (days <= 30) return { text: `${days}d left`, kind: 'warn' };
  if (days <= 90) return { text: `${days}d left`, kind: 'ok' };
  return { text: `${days}d left`, kind: 'idle' };
}
