import { useEffect, useRef, useState } from 'react';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
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
  genId,
  suggestMachineUid,
  type FoundItem,
  type ItemDetail,
  type ItemIds,
  type ItemStatus,
  type Machine,
  type ProblemLogEntry,
  type PurchaseInfo,
  type SpareCategory,
  type SpareItem,
} from '../lib/inventory';
import { BrandGlyph, categoryIcon, componentIcon, roleIcon } from '../lib/inventoryIcons';
import { Editable } from './InventoryPage';

type Mutator<T> = (mut: (cur: T) => T) => void;

interface Props {
  found: FoundItem;
  isEditing: boolean;
  onChange: (id: string, mut: (item: Machine | SpareItem) => Machine | SpareItem) => void;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'working',   label: 'working' },
  { value: 'broken',    label: 'broken' },
  { value: 'in-repair', label: 'in-repair' },
  { value: 'retired',   label: 'retired' },
];

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

export function InventoryDetailPanel({ found, isEditing, onChange, onClose }: Props) {
  const itemId = found.kind === 'machine' ? found.machine.id : found.item.id;
  const status: ItemStatus =
    (found.kind === 'machine' ? found.machine.status : found.item.status) ?? 'working';

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  // Trap initial focus on the panel for a11y.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, [itemId]);

  const mutDetail: Mutator<ItemDetail> = (mut) => {
    onChange(itemId, (cur) => ({ ...cur, ...mut(cur) }) as Machine | SpareItem);
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

  const purchase = (found.kind === 'machine' ? found.machine.purchase : found.item.purchase) ?? {};
  const ids = (found.kind === 'machine' ? found.machine.ids : found.item.ids) ?? {};
  const log = (found.kind === 'machine' ? found.machine.problemLog : found.item.problemLog) ?? [];

  const kindClass = STATUS_KIND[status];
  const StatusGlyph = STATUS_ICON[status];

  // Header label content
  const header = found.kind === 'machine'
    ? <MachineHeader machine={found.machine} isEditing={isEditing} onChange={(mut) => onChange(itemId, mut as (m: Machine | SpareItem) => Machine | SpareItem)} />
    : <SpareHeader item={found.item} category={found.category} isEditing={isEditing} onChange={(mut) => onChange(itemId, mut as (m: Machine | SpareItem) => Machine | SpareItem)} />;

  return (
    <div className="inv-detail-scrim" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className={`inv-detail-panel status-${kindClass}`}
        role="dialog"
        aria-label="Item details"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="inv-detail-stripe" aria-hidden />

        <header className="inv-detail-head">
          {header}
          <div className="inv-detail-head-actions">
            <StatusPicker status={status} onChange={setStatus} />
            <button type="button" className="iconbtn ghost" onClick={onClose} title="Close (Esc)">
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <div className="inv-detail-body">
          <Section icon={Receipt} title="Provenance">
            <Field label="Purchased"  icon={Calendar}>
              <DateInput value={purchase.date}        onChange={(v) => setPurchase({ date: v })} />
            </Field>
            <Field label="Vendor"     icon={Briefcase}>
              <TextInput value={purchase.vendor}      onChange={(v) => setPurchase({ vendor: v })} placeholder="Where you bought it" />
            </Field>
            <Field label="Price"      icon={Tag}>
              <TextInput value={purchase.price}       onChange={(v) => setPurchase({ price: v })}  placeholder="$0.00" mono />
            </Field>
            <Field label="Receipt #"  icon={Hash}>
              <TextInput value={purchase.receiptRef}  onChange={(v) => setPurchase({ receiptRef: v })} placeholder="Order or receipt reference" mono />
            </Field>
            <Field label="Warranty"   icon={ShieldCheck}>
              <DateInput value={purchase.warrantyEnd} onChange={(v) => setPurchase({ warrantyEnd: v })} hint={warrantyHint(purchase.warrantyEnd)} />
            </Field>
          </Section>

          <Section icon={Fingerprint} title="Identifiers">
            <Field label="Serial #"   icon={Hash}>
              <TextInput value={ids.serial}    onChange={(v) => setIds({ serial: v })}    placeholder="Manufacturer serial" mono />
            </Field>
            <Field label="UID"        icon={Sparkles}>
              <UidInput
                value={ids.uid}
                suggestion={found.kind === 'machine' ? suggestMachineUid(found.machine.name) : undefined}
                onChange={(v) => setIds({ uid: v })}
              />
            </Field>
            <Field label="MAC"        icon={Wifi}>
              <TextInput value={ids.mac}       onChange={(v) => setIds({ mac: v })}       placeholder="AA:BB:CC:DD:EE:FF" mono />
            </Field>
            <Field label="Asset tag"  icon={Tag}>
              <TextInput value={ids.assetTag}  onChange={(v) => setIds({ assetTag: v })}  placeholder="Internal asset tag" mono />
            </Field>
            <Field label="Location"   icon={MapPin}>
              <TextInput value={ids.location}  onChange={(v) => setIds({ location: v })}  placeholder="Office · rack · shelf" />
            </Field>
          </Section>

          {found.kind === 'machine' ? <ComponentsSection machine={found.machine} /> : null}

          <ProblemLogSection
            log={log}
            status={status}
            onAdd={addLogEntry}
            onUpdate={updateLogEntry}
            onRemove={removeLogEntry}
          />
        </div>
      </aside>
    </div>
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
    <div className="inv-detail-head-id">
      <div className="inv-detail-ordinal">
        <span className="ord mono tnum">{machine.ordinal ?? '—'}</span>
        <span className="ord-of">/ machine</span>
      </div>
      <div className="inv-detail-id-text">
        <h2 className="inv-detail-name">
          <Editable
            value={machine.name}
            editing={isEditing}
            onChange={(name) => onChange((cur) => ({ ...cur, name }))}
            placeholder="Machine name"
          />
        </h2>
        <div className="inv-detail-sub">
          <RoleIcon size={12} strokeWidth={1.75} />
          <Editable
            value={machine.role}
            editing={isEditing}
            onChange={(role) => onChange((cur) => ({ ...cur, role }))}
            placeholder="Role / purpose"
          />
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
    <div className="inv-detail-head-id">
      <div className="inv-detail-ordinal">
        <span className="ord-of mono">spare</span>
        <span className="ord-cat"><CatIcon size={14} strokeWidth={1.75} /> {category.name}</span>
      </div>
      <div className="inv-detail-id-text">
        <h2 className="inv-detail-name">
          {brand ? <BrandGlyph text={brand} size={18} /> : null}
          <span className="spare-title-text">{title}</span>
        </h2>
        <div className="inv-detail-sub">
          {category.columns.slice(0, 4).map((col) => {
            const v = item.values[col.id];
            if (!v) return null;
            return (
              <span key={col.id} className="inv-detail-chip">
                <span className="lbl">{col.label}</span>
                <Editable
                  value={v}
                  editing={isEditing}
                  onChange={(nv) => onChange((cur) => ({ ...cur, values: { ...cur.values, [col.id]: nv } }))}
                  placeholder="—"
                  mono={col.id === 'model' || col.id === 'part'}
                />
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function describeSpare(item: SpareItem, category: SpareCategory): string {
  const brand = item.values.brand?.trim();
  const model = item.values.model?.trim() || item.values.part?.trim();
  if (brand && model) return `${brand} ${model}`;
  if (model) return model;
  if (brand) return brand;
  return `${category.name.replace(/s$/, '')} item`;
}

/* ------------------------------------------------------------------ */
/* Status picker                                                      */
/* ------------------------------------------------------------------ */

function StatusPicker({ status, onChange }: { status: ItemStatus; onChange: (s: ItemStatus) => void }) {
  const [open, setOpen] = useState(false);
  const Glyph = STATUS_ICON[status];
  const kind = STATUS_KIND[status];
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', fn);
    return () => window.removeEventListener('mousedown', fn);
  }, [open]);

  return (
    <div className="inv-detail-status-wrap" ref={ref}>
      <button
        type="button"
        className={`pill ${kind} inv-detail-status`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change status"
      >
        <Glyph size={12} strokeWidth={1.75} />
        <span>{status}</span>
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open ? (
        <ul className="inv-detail-status-menu" role="listbox">
          {STATUS_OPTIONS.map((opt) => {
            const OptGlyph = STATUS_ICON[opt.value];
            const optKind = STATUS_KIND[opt.value];
            const isCurrent = opt.value === status;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  className={`inv-detail-status-opt ${isCurrent ? 'is-on' : ''}`}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  role="option"
                  aria-selected={isCurrent}
                >
                  <span className={`pill ${optKind}`}>
                    <OptGlyph size={11} strokeWidth={1.75} />
                    {opt.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section + Field building blocks                                    */
/* ------------------------------------------------------------------ */

interface SectionProps {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  accent?: 'bad' | 'warn';
}

function Section({ icon: Icon, title, children, accent }: SectionProps) {
  return (
    <section className={`inv-detail-section ${accent ? `accent-${accent}` : ''}`}>
      <h3 className="inv-detail-section-head">
        <Icon size={12} strokeWidth={1.75} />
        <span>{title}</span>
      </h3>
      <div className="inv-detail-fields">{children}</div>
    </section>
  );
}

interface FieldProps {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}

function Field({ label, icon: Icon, children }: FieldProps) {
  return (
    <div className="inv-detail-field">
      <div className="inv-detail-field-lbl">
        {Icon ? <Icon size={11} strokeWidth={1.75} /> : null}
        <span>{label}</span>
      </div>
      <div className="inv-detail-field-val">{children}</div>
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
    <input
      type="text"
      className={`inv-detail-input ${mono ? 'mono' : ''}`}
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
    <div className="inv-detail-date-wrap">
      <input
        type="date"
        className="inv-detail-input mono"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className={`inv-detail-hint ${hint.kind}`}>{hint.text}</span> : null}
    </div>
  );
}

function UidInput({
  value, onChange, suggestion,
}: { value?: string; onChange: (v: string) => void; suggestion?: string }) {
  const empty = !value || !value.trim();
  return (
    <div className="inv-detail-uid-wrap">
      <TextInput value={value} onChange={onChange} placeholder={suggestion ? `auto: ${suggestion}` : 'Custom UID'} mono />
      {empty && suggestion ? (
        <button
          type="button"
          className="inv-detail-uid-apply"
          onClick={() => onChange(suggestion)}
          title={`Use suggested UID: ${suggestion}`}
        >
          <Sparkles size={11} strokeWidth={1.75} /> use
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Components (machines only)                                         */
/* ------------------------------------------------------------------ */

function ComponentsSection({ machine }: { machine: Machine }) {
  return (
    <section className="inv-detail-section">
      <h3 className="inv-detail-section-head">
        <Settings2 size={12} strokeWidth={1.75} />
        <span>Components</span>
        <span className="ct mono tnum">{machine.components.length}</span>
      </h3>
      <ul className="inv-detail-comps">
        {machine.components.map((row) => {
          const CompIcon = componentIcon(row.component);
          return (
            <li key={row.id} className="inv-detail-comp-row">
              <span className="inv-detail-comp-lbl">
                {CompIcon ? <CompIcon size={11} strokeWidth={1.75} /> : <Cpu size={11} strokeWidth={1.75} />}
                {row.component}
              </span>
              <span className="inv-detail-comp-val">
                <BrandGlyph text={row.specification} size={14} reserveSpace />
                <span>{row.specification || '—'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
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
    <section className={`inv-detail-section ${accent ? `accent-${accent}` : ''}`}>
      <h3 className="inv-detail-section-head">
        <Wrench size={12} strokeWidth={1.75} />
        <span>Problem log</span>
        <span className="ct mono tnum">{log.length}</span>
      </h3>
      <ul className="inv-detail-log">
        {log.length === 0 ? (
          <li className="inv-detail-log-empty">No entries yet — describe the issue below.</li>
        ) : null}
        {log.map((entry) => (
          <li key={entry.id} className="inv-detail-log-row">
            <input
              type="date"
              className="inv-detail-log-date mono"
              value={entry.date}
              onChange={(e) => onUpdate(entry.id, { date: e.target.value })}
            />
            <textarea
              className="inv-detail-log-note"
              value={entry.note}
              rows={2}
              onChange={(e) => onUpdate(entry.id, { note: e.target.value })}
            />
            <button
              type="button"
              className="iconbtn ghost inv-detail-log-del"
              onClick={() => onRemove(entry.id)}
              title="Remove entry"
            >
              <X size={11} strokeWidth={2} />
            </button>
          </li>
        ))}
      </ul>
      {allowAdd ? <AddLogEntry onAdd={onAdd} /> : null}
    </section>
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
    <div className="inv-detail-log-add">
      <input
        type="date"
        className="inv-detail-log-date mono"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <textarea
        className="inv-detail-log-note"
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
      <button
        type="button"
        className="inv-detail-log-submit"
        onClick={submit}
        disabled={!note.trim()}
        title="Add entry (Ctrl/Cmd+Enter)"
      >
        <Plus size={12} strokeWidth={2} /> log
      </button>
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
