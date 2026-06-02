import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Cpu,
  Download,
  Layers,
  ListOrdered,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import {
  COMPONENT_BLOCKS,
  COMPONENT_TYPE_FIELDS,
  COMPONENT_TYPE_LABELS,
  detectDeviceType,
  DEVICE_BLOCKS,
  componentTitle,
  exportInventoryJSON,
  findItem,
  genId,
  getLastUidMap,
  loadInventory,
  nextComponentUid,
  nextDeviceUid,
  resetInventory,
  saveInventory,
  SPARE,
  summarize,
  tryImportInventoryJSON,
  type Component,
  type ComponentType,
  type Inventory,
  type Machine,
  type SpareCategory,
  type SpareColumn,
  type SpareItem,
} from '../lib/inventory';
import { BrandGlyph, categoryIcon, componentIcon, roleIcon } from '../lib/inventoryIcons';
import { InventoryDetailPanel } from './InventoryDetailPanel';
import { StatusBadge, type StatusKind } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Tab = 'machines' | 'network' | 'service' | 'spares';
type Mode = 'browse' | 'edit';

const GHOST_ICON_BTN =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-bad';
const ADD_ROW_BTN =
  'inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-brand';

/** Component types in UID-block order, for stable grouping. */
const TYPE_ORDER = (Object.entries(COMPONENT_BLOCKS) as [ComponentType, number][])
  .sort((a, b) => a[1] - b[1])
  .map(([t]) => t);

interface InventoryPageProps {
  selectedItemId?: string;
  onSelectItem?: (id: string | undefined) => void;
}

export function InventoryPage({ selectedItemId, onSelectItem }: InventoryPageProps = {}) {
  const [inv, setInv] = useState<Inventory>(() => loadInventory());
  const [tab, setTab] = useState<Tab>('machines');
  const [mode, setMode] = useState<Mode>('browse');
  const [query, setQuery] = useState('');
  const [spareFilter, setSpareFilter] = useState('all');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectItem = useCallback((id: string | undefined) => onSelectItem?.(id), [onSelectItem]);

  // Skip the initial mount: loadInventory already returned the persisted value.
  const didMountInv = useRef(false);
  useEffect(() => {
    if (!didMountInv.current) {
      didMountInv.current = true;
      return;
    }
    saveInventory(inv);
  }, [inv]);

  useEffect(() => {
    if (!selectedItemId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selectedItemId]);

  const stats = useMemo(() => summarize(inv), [inv]);
  const isEditing = mode === 'edit';
  const q = query.trim().toLowerCase();

  const patch = useCallback((mut: (draft: Inventory) => Inventory) => {
    setInv((prev) => mut(prev));
  }, []);

  /* ---------- mutations ---------- */

  const updateItemById = useCallback(
    (
      id: string,
      mut: (item: Machine | SpareItem | Component) => Machine | SpareItem | Component,
    ) => {
      patch((prev) => {
        if (prev.machines.some((m) => m.id === id)) {
          return {
            ...prev,
            machines: prev.machines.map((m) => (m.id === id ? (mut(m) as Machine) : m)),
            lastUpdated: today(),
          };
        }
        if (prev.components.some((c) => c.id === id)) {
          return {
            ...prev,
            components: prev.components.map((c) => (c.id === id ? (mut(c) as Component) : c)),
            lastUpdated: today(),
          };
        }
        return {
          ...prev,
          spares: prev.spares.map((cat) => ({
            ...cat,
            items: cat.items.map((it) => (it.id === id ? (mut(it) as SpareItem) : it)),
          })),
          lastUpdated: today(),
        };
      });
    },
    [patch],
  );

  const updateMachine = (id: string, mut: (m: Machine) => Machine) =>
    patch((prev) => ({
      ...prev,
      machines: prev.machines.map((m) => (m.id === id ? mut(m) : m)),
      lastUpdated: today(),
    }));

  const updateCategory = (id: string, mut: (c: SpareCategory) => SpareCategory) =>
    patch((prev) => ({
      ...prev,
      spares: prev.spares.map((c) => (c.id === id ? mut(c) : c)),
      lastUpdated: today(),
    }));

  const addMachine = () => {
    patch((prev) => {
      const ord = String(prev.machines.length + 1).padStart(2, '0');
      const next: Machine = {
        id: genId('mach'),
        ordinal: ord,
        name: 'New machine',
        role: 'Role / purpose',
        deployment: 'in-service',
        meta: [],
        ids: {
          uid: nextDeviceUid(
            '08',
            prev.machines.map((m) => m.ids?.uid),
          ),
        },
        status: 'working',
        purchase: {},
        problemLog: [],
      };
      return { ...prev, machines: [...prev.machines, next], lastUpdated: today() };
    });
    setMode('edit');
  };

  const deleteMachine = (id: string) => {
    if (!confirm('Delete this machine? Its components will be moved to Spare.')) return;
    patch((prev) => ({
      ...prev,
      machines: prev.machines.filter((m) => m.id !== id),
      components: prev.components.map((c) =>
        c.assignment === id ? { ...c, assignment: SPARE } : c,
      ),
      lastUpdated: today(),
    }));
  };

  /** Add a component to the pool (assignment = machine id or SPARE) and open it. */
  const addComponent = (type: ComponentType, assignment: string) => {
    const id = genId('comp');
    patch((prev) => {
      const next: Component = {
        id,
        type,
        label: COMPONENT_TYPE_LABELS[type],
        fields: COMPONENT_TYPE_FIELDS[type].map((l) => ({ id: genId('f'), label: l, value: '' })),
        assignment,
        ids: { uid: nextComponentUid(type, prev.components) },
        status: 'working',
        purchase: {},
        problemLog: [],
      };
      return { ...prev, components: [...prev.components, next], lastUpdated: today() };
    });
    setMode('edit');
    selectItem(id);
  };

  const deleteComponent = (id: string) => {
    patch((prev) => ({
      ...prev,
      components: prev.components.filter((c) => c.id !== id),
      lastUpdated: today(),
    }));
  };

  const addCategory = () => {
    const name = prompt('Category name (e.g. "Monitors"):')?.trim();
    if (!name) return;
    const colsRaw = prompt('Column names, comma-separated:', 'Brand, Model, Notes')?.trim();
    if (!colsRaw) return;
    const columns: SpareColumn[] = colsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ id: slugColumn(label), label }));
    if (columns.length === 0) return;
    patch((prev) => {
      const deviceType = detectDeviceType(name);
      return {
        ...prev,
        spares: [
          ...prev.spares,
          {
            id: genId('cat'),
            name,
            deviceType,
            prefix: DEVICE_BLOCKS[deviceType],
            columns,
            items: [],
          },
        ],
        lastUpdated: today(),
      };
    });
    setMode('edit');
  };

  const deleteCategory = (id: string) => {
    if (!confirm('Delete this entire category and all its items?')) return;
    patch((prev) => ({
      ...prev,
      spares: prev.spares.filter((c) => c.id !== id),
      lastUpdated: today(),
    }));
  };

  /* ---------- import / export ---------- */

  const onExport = () => {
    download(`homelab-inventory-${today()}.json`, exportInventoryJSON(inv), 'application/json');
    toast.success('Exported inventory JSON');
  };

  const onDownloadUidMap = () => {
    const map = getLastUidMap();
    if (!map.length) {
      toast('No migration map this session — UIDs are already current.');
      return;
    }
    const csv = [
      'old,new,label',
      ...map.map((e) => `${csvCell(e.old)},${csvCell(e.new)},${csvCell(e.label)}`),
    ].join('\n');
    download(`homelab-uid-map-${today()}.csv`, csv, 'text/csv');
    toast.success('Downloaded old → new UID map');
  };

  const onPickImport = () => fileInputRef.current?.click();

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = tryImportInventoryJSON(await file.text());
    if (!parsed) {
      toast.error('Import failed — not a valid inventory file');
      return;
    }
    if (!confirm('Replace current inventory with imported data?')) return;
    setInv({ ...parsed, lastUpdated: today() });
    toast.success('Imported inventory');
  };

  const onReset = () => {
    if (!confirm('Reset to default seed inventory? Local changes will be lost.')) return;
    setInv(resetInventory());
    toast.success('Reset to default inventory');
  };

  /* ---------- derived ---------- */

  const selectedFound = useMemo(
    () => (selectedItemId ? findItem(inv, selectedItemId) : null),
    [inv, selectedItemId],
  );
  useEffect(() => {
    if (selectedItemId && !selectedFound) selectItem(undefined);
  }, [selectedItemId, selectedFound, selectItem]);

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <Masthead
        inv={inv}
        stats={stats}
        tab={tab}
        setTab={setTab}
        mode={mode}
        setMode={setMode}
        query={query}
        setQuery={setQuery}
        onExport={onExport}
        onImport={onPickImport}
        onReset={onReset}
        onUidMap={onDownloadUidMap}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onImportFile}
        className="hidden"
      />

      {tab === 'machines' ? (
        <MachinesTab
          inv={inv}
          isEditing={isEditing}
          query={q}
          updateMachine={updateMachine}
          deleteMachine={deleteMachine}
          addMachine={addMachine}
          addComponent={addComponent}
          onOpenItem={selectItem}
          openItemId={selectedItemId}
        />
      ) : tab === 'network' ? (
        <NetworkTab
          inv={inv}
          isEditing={isEditing}
          query={q}
          updateCategory={updateCategory}
          deleteCategory={deleteCategory}
          addCategory={addCategory}
          onOpenItem={selectItem}
          openItemId={selectedItemId}
        />
      ) : tab === 'service' ? (
        <ServiceTab
          inv={inv}
          isEditing={isEditing}
          query={q}
          addComponent={addComponent}
          onOpenItem={selectItem}
          openItemId={selectedItemId}
        />
      ) : (
        <SparesTab
          inv={inv}
          isEditing={isEditing}
          query={q}
          filter={spareFilter}
          setFilter={setSpareFilter}
          updateCategory={updateCategory}
          deleteCategory={deleteCategory}
          addCategory={addCategory}
          addComponent={addComponent}
          deleteComponent={deleteComponent}
          onOpenItem={selectItem}
          openItemId={selectedItemId}
        />
      )}

      {selectedFound ? (
        <InventoryDetailPanel
          found={selectedFound}
          isEditing={isEditing}
          machines={inv.machines}
          components={inv.components}
          onChange={updateItemById}
          onClose={() => selectItem(undefined)}
        />
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* Masthead — original 4 tabs                                          */
/* ================================================================== */

interface MastheadProps {
  inv: Inventory;
  stats: ReturnType<typeof summarize>;
  tab: Tab;
  setTab: (t: Tab) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  query: string;
  setQuery: (s: string) => void;
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
  onUidMap: () => void;
}

function MhStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-display text-xl font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Masthead({
  inv,
  stats,
  tab,
  setTab,
  mode,
  setMode,
  query,
  setQuery,
  onExport,
  onImport,
  onReset,
  onUidMap,
}: MastheadProps) {
  const isEditing = mode === 'edit';
  const count = (n: ReactNode) => (
    <span className="ml-1 text-[11px] tabular-nums opacity-60">{n}</span>
  );
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Datacenter index
          </span>
          <h2 className="font-display text-xl tracking-tight text-foreground">Inventory</h2>
          <span className="font-mono text-xs text-muted-foreground">Updated {inv.lastUpdated}</span>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <MhStat label="Machines" value={pad2(stats.machineCount)} />
          <MhStat label="Installed parts" value={stats.installedComponentCount} />
          <MhStat label="Spare parts" value={stats.spareComponentCount} />
          <MhStat label="Devices" value={stats.deviceItemCount} />
        </dl>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="machines">
              <Server className="size-3.5" /> Active machines {count(pad2(stats.machineCount))}
            </TabsTrigger>
            <TabsTrigger value="network">
              <Network className="size-3.5" /> Network {count(pad2(stats.networkItemCount))}
            </TabsTrigger>
            <TabsTrigger value="service">
              <Settings2 className="size-3.5" /> In service {count(stats.installedComponentCount)}
            </TabsTrigger>
            <TabsTrigger value="spares">
              <Layers className="size-3.5" /> Spare parts{' '}
              {count(stats.spareComponentCount + stats.deviceItemCount)}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-52 pl-8"
            />
          </div>
          <Button
            variant={isEditing ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode(isEditing ? 'browse' : 'edit')}
            title={isEditing ? 'Finish editing' : 'Enable inline editing'}
          >
            <Pencil className="size-3.5" />
            {isEditing ? 'Done editing' : 'Edit'}
          </Button>
          <IconBtn label="Export JSON" onClick={onExport}>
            <Download className="size-3.5" />
          </IconBtn>
          <IconBtn label="Import JSON" onClick={onImport}>
            <Upload className="size-3.5" />
          </IconBtn>
          <IconBtn label="Download old → new UID map" onClick={onUidMap}>
            <ListOrdered className="size-3.5" />
          </IconBtn>
          <IconBtn label="Reset to defaults" onClick={onReset}>
            <RefreshCw className="size-3.5" />
          </IconBtn>
        </div>
      </div>
    </section>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center text-sm text-muted-foreground shadow-card">
      {children}
    </div>
  );
}

function iconOf(Icon: ReturnType<typeof categoryIcon>): ReactNode {
  return <Icon className="size-3" strokeWidth={1.75} />;
}

function matchMachine(m: Machine, q: string): boolean {
  if (!q) return true;
  return `${m.name} ${m.role} ${m.meta.map((r) => `${r.label} ${r.value}`).join(' ')}`
    .toLowerCase()
    .includes(q);
}
function matchItem(it: SpareItem, q: string): boolean {
  if (!q) return true;
  return `${it.name ?? ''} ${Object.values(it.values).join(' ')}`.toLowerCase().includes(q);
}
function matchComponent(c: Component, q: string): boolean {
  if (!q) return true;
  return `${c.label} ${componentTitle(c)} ${c.fields.map((f) => f.value).join(' ')} ${c.ids?.uid ?? ''}`
    .toLowerCase()
    .includes(q);
}

/* ================================================================== */
/* Active machines tab                                                 */
/* ================================================================== */

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

function MachinesTab({
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {machines.map((m) => (
        <MachineCard
          key={m.id}
          machine={m}
          components={inv.components.filter((c) => c.assignment === m.id)}
          isEditing={isEditing}
          onChange={(mut) => updateMachine(m.id, mut)}
          onDelete={() => deleteMachine(m.id)}
          onAddComponent={() => addComponent('other', m.id)}
          onOpen={() => onOpenItem(m.id)}
          onOpenComponent={onOpenItem}
          isOpen={openItemId === m.id}
        />
      ))}
      {isEditing ? (
        <button
          type="button"
          className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card/50 text-muted-foreground transition-colors hover:border-brand hover:text-brand"
          onClick={addMachine}
        >
          <Plus className="size-5" strokeWidth={1.75} />
          <span className="text-sm font-medium">New machine</span>
        </button>
      ) : null}
    </div>
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

/* ================================================================== */
/* Network tab — in-service device categories (network + cameras)      */
/* ================================================================== */

interface DeviceTabProps {
  inv: Inventory;
  isEditing: boolean;
  query: string;
  updateCategory: (id: string, mut: (c: SpareCategory) => SpareCategory) => void;
  deleteCategory: (id: string) => void;
  addCategory: () => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

function NetworkTab({
  inv,
  isEditing,
  query,
  updateCategory,
  deleteCategory,
  onOpenItem,
  openItemId,
}: DeviceTabProps) {
  const cats = inv.spares
    .map((cat) => ({
      cat,
      items: cat.items.filter(
        (it) => (it.deployment ?? 'spare') === 'in-service' && matchItem(it, query),
      ),
    }))
    .filter(
      (g) =>
        g.items.length > 0 ||
        (isEditing && (g.cat.deviceType === 'network' || g.cat.deviceType === 'camera')),
    );

  if (cats.length === 0) {
    return (
      <EmptyState>
        {query
          ? 'No deployed network devices match the search.'
          : 'No deployed network devices yet.'}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {cats.map((g) => (
        <CategoryBlock
          key={g.cat.id}
          category={g.cat}
          items={g.items}
          deployment="in-service"
          isEditing={isEditing}
          onChange={(mut) => updateCategory(g.cat.id, mut)}
          onDelete={() => deleteCategory(g.cat.id)}
          onOpenItem={onOpenItem}
          openItemId={openItemId}
        />
      ))}
    </div>
  );
}

/* ================================================================== */
/* In-service tab — installed components grouped by machine            */
/* ================================================================== */

interface ServiceTabProps {
  inv: Inventory;
  isEditing: boolean;
  query: string;
  addComponent: (type: ComponentType, assignment: string) => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

function ServiceTab({
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

/** Shared table for a list of pool components (UID · Part · Spec · Status). */
function ComponentTable({
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

/* ================================================================== */
/* Spare parts tab — spare device categories + spare components         */
/* ================================================================== */

interface SparesTabProps {
  inv: Inventory;
  isEditing: boolean;
  query: string;
  filter: string;
  setFilter: (s: string) => void;
  updateCategory: (id: string, mut: (c: SpareCategory) => SpareCategory) => void;
  deleteCategory: (id: string) => void;
  addCategory: () => void;
  addComponent: (type: ComponentType, assignment: string) => void;
  deleteComponent: (id: string) => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

interface Chip {
  id: string;
  label: string;
  count: number;
  icon?: ReactNode;
}

function SparesTab({
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
  const deviceGroups = inv.spares
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
          <section
            key={g.type}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
          >
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
          </section>
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

/* ================================================================== */
/* Device category block (table)                                       */
/* ================================================================== */

interface CategoryBlockProps {
  category: SpareCategory;
  items: SpareItem[];
  deployment: 'in-service' | 'spare';
  isEditing: boolean;
  onChange: (mut: (c: SpareCategory) => SpareCategory) => void;
  onDelete: () => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

function CategoryBlock({
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
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
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
    </section>
  );
}

/* ================================================================== */
/* Editable + helpers                                                  */
/* ================================================================== */

function statusKind(s: string): StatusKind {
  if (s === 'working') return 'ok';
  if (s === 'broken') return 'bad';
  if (s === 'in-repair') return 'warn';
  return 'idle';
}

interface EditableProps {
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  multiline?: boolean;
  muted?: boolean;
  maxLength?: number;
}

export function Editable({
  value,
  editing,
  onChange,
  placeholder = '',
  className = '',
  mono = false,
  multiline = false,
  muted = false,
  maxLength,
}: EditableProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const classes = [
    'inv-edit',
    editing ? 'is-editing' : 'is-readonly',
    mono ? 'mono' : '',
    multiline ? 'multi' : '',
    muted ? 'muted' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (!editing) {
    const display = value.length > 0 ? value : placeholder;
    return <span className={classes + (value.length === 0 ? ' is-empty' : '')}>{display}</span>;
  }

  const commit = () => {
    if (draft !== value) onChange(draft);
    setFocused(false);
  };
  const handleKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      setDraft(value);
      (e.target as HTMLElement).blur();
    } else if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

  if (multiline) {
    return (
      <textarea
        className={classes}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onKeyDown={handleKey}
        maxLength={maxLength}
        rows={1}
      />
    );
  }
  return (
    <input
      type="text"
      className={classes}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={handleKey}
      maxLength={maxLength}
    />
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function slugColumn(label: string, taken: string[] = []): string {
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

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(filename: string, content: string, mime: string): void {
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
