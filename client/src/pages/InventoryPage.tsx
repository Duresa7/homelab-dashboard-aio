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
  exportInventoryJSON,
  findItem,
  genId,
  loadInventory,
  nextSpareUid,
  resetInventory,
  saveInventory,
  splitSpec,
  suggestCategoryPrefix,
  summarize,
  tryImportInventoryJSON,
  type Inventory,
  type Machine,
  type SpareCategory,
  type SpareColumn,
  type SpareItem,
  type SpecRow,
} from '../lib/inventory';
import {
  BrandGlyph,
  categoryIcon,
  componentIcon,
  roleIcon,
} from '../lib/inventoryIcons';
import { InventoryDetailPanel } from './InventoryDetailPanel';
import { StatusBadge, type StatusKind } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Tab = 'machines' | 'service' | 'spares' | 'network';
type Mode = 'browse' | 'edit';

const GHOST_ICON_BTN =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-bad';
const ADD_ROW_BTN =
  'inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-brand';

interface InventoryPageProps {
  selectedItemId?: string;
  onSelectItem?: (id: string | undefined) => void;
}

export function InventoryPage({ selectedItemId, onSelectItem }: InventoryPageProps = {}) {
  const [inv, setInv] = useState<Inventory>(() => loadInventory());
  const [tab, setTab] = useState<Tab>('machines');
  const [mode, setMode] = useState<Mode>('browse');
  const [query, setQuery] = useState('');
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectItem = useCallback(
    (id: string | undefined) => onSelectItem?.(id),
    [onSelectItem],
  );

  // Skip the initial mount: loadInventory already returned the persisted
  // value, so writing it back is both redundant *and* destructive in the
  // forward-compat case where the persisted schema version is higher than
  // this build understands.
  const didMountInv = useRef(false);
  useEffect(() => {
    if (!didMountInv.current) { didMountInv.current = true; return; }
    saveInventory(inv);
  }, [inv]);

  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`cat-${jumpTo}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setJumpTo(null);
  }, [jumpTo]);

  useEffect(() => {
    if (!selectedItemId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [selectedItemId]);

  const stats = useMemo(() => summarize(inv), [inv]);
  const isEditing = mode === 'edit';
  const q = query.trim().toLowerCase();

  const patch = useCallback((mut: (draft: Inventory) => Inventory) => {
    setInv((prev) => mut(prev));
  }, []);

  const updateMachine = (id: string, mut: (m: Machine) => Machine) => {
    patch((prev) => ({
      ...prev,
      machines: prev.machines.map((m) => (m.id === id ? mut(m) : m)),
      lastUpdated: today(),
    }));
  };

  const updateCategory = (id: string, mut: (c: SpareCategory) => SpareCategory) => {
    patch((prev) => ({
      ...prev,
      spares: prev.spares.map((c) => (c.id === id ? mut(c) : c)),
      lastUpdated: today(),
    }));
  };

  const updateItemById = useCallback(
    (id: string, mut: (item: Machine | SpareItem | SpecRow) => Machine | SpareItem | SpecRow) => {
      patch((prev) => {
        if (prev.machines.some((m) => m.id === id)) {
          return {
            ...prev,
            machines: prev.machines.map((m) => (m.id === id ? (mut(m) as Machine) : m)),
            lastUpdated: today(),
          };
        }
        if (prev.machines.some((m) => m.components.some((c) => c.id === id))) {
          return {
            ...prev,
            machines: prev.machines.map((m) => ({
              ...m,
              components: m.components.map((c) => (c.id === id ? (mut(c) as SpecRow) : c)),
            })),
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

  const addMachine = () => {
    patch((prev) => {
      const ord = String(prev.machines.length + 1).padStart(2, '0');
      const next: Machine = {
        id: genId('mach'),
        ordinal: ord,
        name: 'New machine',
        role: 'Role / purpose',
        meta: [],
        components: [
          { id: genId('c'), component: 'CPU', specification: '' },
        ],
      };
      return { ...prev, machines: [...prev.machines, next], lastUpdated: today() };
    });
    setMode('edit');
  };

  const deleteMachine = (id: string) => {
    if (!confirm('Delete this machine and all its components?')) return;
    patch((prev) => ({
      ...prev,
      machines: prev.machines.filter((m) => m.id !== id),
      lastUpdated: today(),
    }));
  };

  const addCategory = () => {
    const name = prompt('Category name (e.g. "GPUs"):')?.trim();
    if (!name) return;
    const colsRaw = prompt('Column names, comma-separated (e.g. "Brand, Model, Notes"):', 'Brand, Model, Notes')?.trim();
    if (!colsRaw) return;
    const columns: SpareColumn[] = colsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ id: slugColumn(label), label }));
    if (columns.length === 0) return;
    patch((prev) => {
      const usedPrefixes = prev.spares
        .map((c) => c.prefix)
        .filter((p): p is string => Boolean(p));
      const prefix = suggestCategoryPrefix(name, usedPrefixes);
      return {
        ...prev,
        spares: [
          ...prev.spares,
          { id: genId('cat'), name, prefix, columns, items: [] },
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


  const onExport = () => {
    const json = exportInventoryJSON(inv);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `homelab-inventory-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Exported inventory JSON');
  };

  const onPickImport = () => fileInputRef.current?.click();

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const parsed = tryImportInventoryJSON(text);
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


  const machinesView = useMemo(() => filterMachines(inv.machines, q), [inv.machines, q]);
  const sparesAll    = useMemo(() => inv.spares.filter((c) => c.kind !== 'network'), [inv.spares]);
  const networkAll   = useMemo(() => inv.spares.filter((c) => c.kind === 'network'), [inv.spares]);
  const sparesView   = useMemo(() => filterSpares(sparesAll,  q), [sparesAll, q]);
  const networkView  = useMemo(() => filterSpares(networkAll, q), [networkAll, q]);

  const selectedFound = useMemo(
    () => (selectedItemId ? findItem(inv, selectedItemId) : null),
    [inv, selectedItemId],
  );

  // If a previously-selected id no longer exists (e.g. deleted), clear it.
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
          machines={machinesView}
          isEditing={isEditing}
          updateMachine={updateMachine}
          deleteMachine={deleteMachine}
          addMachine={addMachine}
          totalMachines={inv.machines.length}
          isSearching={q.length > 0}
          onOpenItem={selectItem}
          openItemId={selectedItemId}
        />
      ) : tab === 'service' ? (
        <ServiceTab
          machines={inv.machines}
          query={q}
          onOpenItem={selectItem}
          openItemId={selectedItemId}
        />
      ) : tab === 'network' ? (
        <SparesTab
          spares={networkView}
          isEditing={isEditing}
          updateCategory={updateCategory}
          deleteCategory={deleteCategory}
          addCategory={addCategory}
          totalCategories={networkAll.length}
          isSearching={q.length > 0}
          onJump={setJumpTo}
          onOpenItem={selectItem}
          openItemId={selectedItemId}
        />
      ) : (
        <SparesTab
          spares={sparesView}
          isEditing={isEditing}
          updateCategory={updateCategory}
          deleteCategory={deleteCategory}
          addCategory={addCategory}
          totalCategories={sparesAll.length}
          isSearching={q.length > 0}
          onJump={setJumpTo}
          onOpenItem={selectItem}
          openItemId={selectedItemId}
        />
      )}

      {selectedFound ? (
        <InventoryDetailPanel
          found={selectedFound}
          isEditing={isEditing}
          onChange={updateItemById}
          onClose={() => selectItem(undefined)}
        />
      ) : null}
    </div>
  );
}

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
  inv, stats, tab, setTab, mode, setMode, query, setQuery,
  onExport, onImport, onReset,
}: MastheadProps) {
  const isEditing = mode === 'edit';
  const count = (n: ReactNode) => <span className="ml-1 text-[11px] tabular-nums opacity-60">{n}</span>;
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
          <MhStat label="Components" value={stats.componentCount} />
          <MhStat label="Categories" value={pad2(stats.spareCategoryCount)} />
          <MhStat label="Spare items" value={stats.spareItemCount} />
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
              <Settings2 className="size-3.5" /> In service {count(stats.componentCount)}
            </TabsTrigger>
            <TabsTrigger value="spares">
              <Layers className="size-3.5" /> Spare parts {count(pad2(stats.spareCategoryCount))}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder={
                tab === 'machines' ? 'Filter machines, components, specs…' :
                tab === 'service'  ? 'Filter installed components…' :
                                     'Filter categories, brands, models…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-60 pl-8"
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" onClick={onExport} aria-label="Export JSON">
                <Download className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export JSON</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" onClick={onImport} aria-label="Import JSON">
                <Upload className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import JSON</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" onClick={onReset} aria-label="Reset to defaults">
                <RefreshCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to defaults</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center text-sm text-muted-foreground shadow-card">
      {children}
    </div>
  );
}

interface MachinesTabProps {
  machines: Machine[];
  totalMachines: number;
  isEditing: boolean;
  isSearching: boolean;
  updateMachine: (id: string, mut: (m: Machine) => Machine) => void;
  deleteMachine: (id: string) => void;
  addMachine: () => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

function MachinesTab({
  machines, totalMachines, isEditing, isSearching,
  updateMachine, deleteMachine, addMachine,
  onOpenItem, openItemId,
}: MachinesTabProps) {
  if (machines.length === 0) {
    return (
      <EmptyState>
        {isSearching
          ? 'No machines match the current search.'
          : 'No machines on file yet. Click “Edit” then “+ New machine” to start.'}
      </EmptyState>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {machines.map((m) => (
        <MachineCard
          key={m.id}
          machine={m}
          isEditing={isEditing}
          onChange={(mut) => updateMachine(m.id, mut)}
          onDelete={() => deleteMachine(m.id)}
          onOpen={() => onOpenItem(m.id)}
          isOpen={openItemId === m.id}
        />
      ))}
      {isEditing ? (
        <button
          type="button"
          className="flex min-h-[180px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card/50 text-muted-foreground transition-colors hover:border-brand hover:text-brand"
          onClick={addMachine}
        >
          <Plus className="size-5" strokeWidth={1.75} />
          <span className="text-sm font-medium">New machine</span>
          <small className="text-xs opacity-80">Adds a blank spec sheet (#{pad2(totalMachines + 1)})</small>
        </button>
      ) : null}
    </div>
  );
}

interface MachineCardProps {
  machine: Machine;
  isEditing: boolean;
  onChange: (mut: (m: Machine) => Machine) => void;
  onDelete: () => void;
  onOpen: () => void;
  isOpen: boolean;
}

function MachineCard({ machine, isEditing, onChange, onDelete, onOpen, isOpen }: MachineCardProps) {
  const m = machine;
  const RoleIcon = roleIcon(m.role, m.name);

  const setName = (name: string) => onChange((cur) => ({ ...cur, name }));
  const setRole = (role: string) => onChange((cur) => ({ ...cur, role }));
  const setOrdinal = (ordinal: string) => onChange((cur) => ({ ...cur, ordinal }));

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

  const updateComp = (id: string, key: 'component' | 'specification', v: string) =>
    onChange((cur) => ({
      ...cur,
      components: cur.components.map((row) => (row.id === id ? { ...row, [key]: v } : row)),
    }));
  const addComp = () =>
    onChange((cur) => ({
      ...cur,
      components: [...cur.components, { id: genId('c'), component: 'Component', specification: '' }],
    }));
  const removeComp = (id: string) =>
    onChange((cur) => ({ ...cur, components: cur.components.filter((r) => r.id !== id) }));

  const openOnClick = (e: React.MouseEvent<HTMLElement>) => {
    // Don't hijack clicks on inputs / textareas / buttons / links.
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, button, a, [contenteditable="true"]')) return;
    onOpen();
  };
  const openOnKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, button')) return;
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
            onChange={setOrdinal}
            placeholder="##"
            className="w-14 font-display text-2xl font-semibold tabular-nums text-brand"
            maxLength={4}
          />
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">machine</span>
        </div>
        <div className="min-w-0 flex-1">
          <Editable
            value={m.name}
            editing={isEditing}
            onChange={setName}
            placeholder="Machine name"
            className="font-display text-base font-semibold text-foreground"
          />
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <RoleIcon size={12} strokeWidth={1.75} className="shrink-0" />
            <Editable
              value={m.role}
              editing={isEditing}
              onChange={setRole}
              placeholder="Role"
              className="text-sm text-muted-foreground"
            />
          </div>
        </div>
        {isEditing ? (
          <button type="button" className={GHOST_ICON_BTN} onClick={onDelete} title="Delete machine">
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      {(m.meta.length > 0 || isEditing) ? (
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
                <button type="button" className={GHOST_ICON_BTN} onClick={() => removeMeta(row.id)} title="Remove meta row">
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

      <section className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Cpu size={12} strokeWidth={1.75} />
          <span>Components</span>
          <span className="ml-auto font-mono tabular-nums">{m.components.length}</span>
        </div>
        <ul className="flex flex-col divide-y divide-border/60">
          {m.components.map((row) => {
            const CompIcon = componentIcon(row.component);
            return (
              <li key={row.id} className="grid grid-cols-[120px_1fr_auto] items-start gap-2 py-1.5">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {CompIcon ? <CompIcon size={12} strokeWidth={1.75} className="shrink-0" /> : null}
                  <Editable
                    value={row.component}
                    editing={isEditing}
                    onChange={(v) => updateComp(row.id, 'component', v)}
                    placeholder="Component"
                    className="text-sm"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                  <BrandGlyph text={row.specification} size={16} />
                  {isEditing ? (
                    <Editable
                      value={row.specification}
                      editing
                      onChange={(v) => updateComp(row.id, 'specification', v)}
                      placeholder="Specification"
                      multiline
                      className="text-sm"
                    />
                  ) : (
                    <span className="truncate">{splitSpec(row.specification).name || '—'}</span>
                  )}
                </div>
                {isEditing ? (
                  <button type="button" className={GHOST_ICON_BTN} onClick={() => removeComp(row.id)} title="Remove component">
                    <X size={12} strokeWidth={2} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {isEditing ? (
          <button type="button" className={ADD_ROW_BTN} onClick={addComp}>
            <Plus size={12} strokeWidth={2} /> component
          </button>
        ) : null}
      </section>
    </article>
  );
}

interface SparesTabProps {
  spares: SpareCategory[];
  totalCategories: number;
  isEditing: boolean;
  isSearching: boolean;
  updateCategory: (id: string, mut: (c: SpareCategory) => SpareCategory) => void;
  deleteCategory: (id: string) => void;
  addCategory: () => void;
  onJump: (id: string) => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

function SparesTab({
  spares, totalCategories, isEditing, isSearching,
  updateCategory, deleteCategory, addCategory, onJump,
  onOpenItem, openItemId,
}: SparesTabProps) {
  if (spares.length === 0) {
    return (
      <EmptyState>
        {isSearching
          ? 'No spare-part categories match the current search.'
          : 'No spare-part categories yet. Click “Edit” then “+ New category” to start.'}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Jump to</span>
        {spares.map((cat) => {
          const CatIcon = categoryIcon(cat.name);
          return (
            <Button key={cat.id} variant="outline" size="xs" onClick={() => onJump(cat.id)}>
              <CatIcon className="size-3" strokeWidth={1.75} />
              {cat.name}
              <span className="tabular-nums text-muted-foreground">{cat.items.length}</span>
            </Button>
          );
        })}
      </nav>

      <div className="flex flex-col gap-4">
        {spares.map((cat) => (
          <CategoryBlock
            key={cat.id}
            category={cat}
            isEditing={isEditing}
            onChange={(mut) => updateCategory(cat.id, mut)}
            onDelete={() => deleteCategory(cat.id)}
            onOpenItem={onOpenItem}
            openItemId={openItemId}
          />
        ))}
        {isEditing ? (
          <button
            type="button"
            className="flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card/50 text-muted-foreground transition-colors hover:border-brand hover:text-brand"
            onClick={addCategory}
          >
            <Plus className="size-5" strokeWidth={1.75} />
            <span className="text-sm font-medium">New category</span>
            <small className="text-xs opacity-80">Define a name and column headers (#{pad2(totalCategories + 1)})</small>
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface CategoryBlockProps {
  category: SpareCategory;
  isEditing: boolean;
  onChange: (mut: (c: SpareCategory) => SpareCategory) => void;
  onDelete: () => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

function CategoryBlock({ category, isEditing, onChange, onDelete, onOpenItem, openItemId }: CategoryBlockProps) {
  const CatIcon = categoryIcon(category.name);
  const setName = (name: string) => onChange((cur) => ({ ...cur, name }));
  const setNote = (note: string) =>
    onChange((cur) => ({ ...cur, note: note.length > 0 ? note : undefined }));
  const setPrefix = (prefix: string) => {
    const clean = prefix.replace(/[^0-9]/g, '').slice(0, 2).padStart(2, '0');
    onChange((cur) => ({ ...cur, prefix: clean }));
  };

  const setItemValue = (itemId: string, colId: string, v: string) =>
    onChange((cur) => ({
      ...cur,
      items: cur.items.map((it) =>
        it.id === itemId ? { ...it, values: { ...it.values, [colId]: v } } : it,
      ),
    }));

  const setItemUid = (itemId: string, uid: string) =>
    onChange((cur) => ({
      ...cur,
      items: cur.items.map((it) =>
        it.id === itemId
          ? { ...it, ids: { ...(it.ids ?? {}), uid: uid.toUpperCase() } }
          : it,
      ),
    }));

  const addItem = () =>
    onChange((cur) => {
      const uid = nextSpareUid(cur);
      return {
        ...cur,
        items: [...cur.items, { id: genId('s'), values: {}, ids: { uid } }],
      };
    });

  const removeItem = (itemId: string) =>
    onChange((cur) => ({ ...cur, items: cur.items.filter((it) => it.id !== itemId) }));

  const setColumnLabel = (colId: string, label: string) =>
    onChange((cur) => ({
      ...cur,
      columns: cur.columns.map((c) => (c.id === colId ? { ...c, label } : c)),
    }));

  const addColumn = () => {
    const label = prompt('New column label:')?.trim();
    if (!label) return;
    onChange((cur) => ({
      ...cur,
      columns: [...cur.columns, { id: slugColumn(label, cur.columns.map((c) => c.id)), label }],
    }));
  };

  const removeColumn = (colId: string) => {
    if (!confirm('Remove this column? All values in this column will be cleared.')) return;
    onChange((cur) => ({
      ...cur,
      columns: cur.columns.filter((c) => c.id !== colId),
      items: cur.items.map((it) => {
        const { [colId]: _drop, ...rest } = it.values;
        return { ...it, values: rest };
      }),
    }));
  };

  const colSpan = category.columns.length + 1 + (isEditing ? 1 : 0);

  return (
    <section id={`cat-${category.id}`} className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="shrink-0 text-muted-foreground [&_svg]:size-4">
          <CatIcon size={16} strokeWidth={1.75} />
        </span>
        <span className="inline-flex items-baseline font-mono text-xs tabular-nums text-muted-foreground" title="Category UID prefix">
          <Editable
            value={category.prefix ?? ''}
            editing={isEditing}
            onChange={setPrefix}
            placeholder="00"
            className="w-7 text-right"
            maxLength={2}
          />
          <span>xx</span>
        </span>
        <h3 className="min-w-0 font-display text-base text-foreground">
          <Editable value={category.name} editing={isEditing} onChange={setName} placeholder="Category name" />
        </h3>
        <Badge variant="secondary" className="font-mono tabular-nums">
          {pad2(category.items.length)} item{category.items.length === 1 ? '' : 's'}
        </Badge>
        {isEditing ? (
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className={ADD_ROW_BTN} onClick={addColumn} title="Add column">
              <Plus size={12} strokeWidth={2} /> col
            </button>
            <button type="button" className={GHOST_ICON_BTN} onClick={onDelete} title="Delete category">
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          </div>
        ) : null}
      </header>

      {(category.note || isEditing) ? (
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
            {category.columns.map((col) => (
              <TableHead key={col.id} className={col.align === 'right' ? 'text-right' : ''}>
                <span className="flex items-center gap-1">
                  <Editable
                    value={col.label}
                    editing={isEditing}
                    onChange={(v) => setColumnLabel(col.id, v)}
                    placeholder="Column"
                  />
                  {isEditing ? (
                    <button type="button" className={GHOST_ICON_BTN} onClick={() => removeColumn(col.id)} title="Remove column">
                      <X size={11} strokeWidth={2} />
                    </button>
                  ) : null}
                </span>
              </TableHead>
            ))}
            {isEditing ? <TableHead className="w-10" aria-label="Row actions" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {category.items.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colSpan} className="py-6 text-center text-muted-foreground">
                No items in this category yet.
              </TableCell>
            </TableRow>
          ) : null}
          {category.items.map((it) => {
            const openRow = (e: React.MouseEvent<HTMLTableRowElement>) => {
              const t = e.target as HTMLElement;
              if (t.closest('input, textarea, button, a, [contenteditable="true"]')) return;
              onOpenItem(it.id);
            };
            const isOpen = openItemId === it.id;
            return (
              <TableRow
                key={it.id}
                className={cn('cursor-pointer', isOpen && 'bg-muted/50')}
                onClick={openRow}
              >
                <TableCell className="font-mono tabular-nums text-muted-foreground">
                  <Editable value={it.ids?.uid ?? ''} editing={isEditing} onChange={(v) => setItemUid(it.id, v)} placeholder="—" mono />
                </TableCell>
                {category.columns.map((col) => {
                  const value = it.values[col.id] ?? '';
                  const isBrand = col.id === 'brand';
                  const isMono = col.id === 'model' || col.id === 'part' || col.align === 'right';
                  return (
                    <TableCell key={col.id} className={col.align === 'right' ? 'text-right tabular-nums' : ''}>
                      {isBrand ? (
                        <span className="flex items-center gap-2">
                          <BrandGlyph text={value} size={16} reserveSpace />
                          <Editable value={value} editing={isEditing} onChange={(v) => setItemValue(it.id, col.id, v)} placeholder="—" mono={isMono} />
                        </span>
                      ) : (
                        <Editable value={value} editing={isEditing} onChange={(v) => setItemValue(it.id, col.id, v)} placeholder="—" mono={isMono} />
                      )}
                    </TableCell>
                  );
                })}
                {isEditing ? (
                  <TableCell>
                    <button type="button" className={GHOST_ICON_BTN} onClick={() => removeItem(it.id)} title="Remove row">
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

/* ---------- In-service components tab ---------- */

interface ServiceTabProps {
  machines: Machine[];
  query: string;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

function isNasLike(m: Machine): boolean {
  return /nas|storage/i.test(m.role) ||
    m.components.some((c) => /^(Drive Bay|NVMe Slot)/.test(c.component));
}

function inServiceComponents(m: Machine): SpecRow[] {
  if (isNasLike(m)) {
    return m.components.filter((c) =>
      /^(Drive Bay|NVMe Slot)/.test(c.component) &&
      !/^empty/i.test(c.specification.trim()),
    );
  }
  return m.components;
}

function ServiceTab({ machines, query, onOpenItem, openItemId }: ServiceTabProps) {
  const sections = useMemo(() => {
    return machines
      .map((m) => {
        let comps = inServiceComponents(m);
        if (query) {
          comps = comps.filter((c) =>
            `${c.component} ${c.specification} ${c.ids?.serial ?? ''} ${c.ids?.uid ?? ''}`
              .toLowerCase()
              .includes(query),
          );
        }
        return { machine: m, comps };
      })
      .filter((s) => s.comps.length > 0);
  }, [machines, query]);

  if (sections.length === 0) {
    return (
      <EmptyState>
        {query
          ? 'No in-service components match the current search.'
          : 'No machines have installed components yet.'}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map(({ machine, comps }) => {
        const RoleIcon = roleIcon(machine.role, machine.name);
        return (
          <section key={machine.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <span className="font-mono text-sm tabular-nums text-muted-foreground">{machine.ordinal ?? '—'}</span>
              <span className="flex items-center gap-1.5">
                <RoleIcon size={14} strokeWidth={1.75} className="text-muted-foreground" />
                <span className="font-display text-base text-foreground">{machine.name}</span>
                <span className="text-sm text-muted-foreground">{machine.role}</span>
              </span>
              <Badge variant="secondary" className="ml-auto font-mono tabular-nums">
                {pad2(comps.length)} component{comps.length === 1 ? '' : 's'}
              </Badge>
            </header>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Type</TableHead>
                  <TableHead>Specification</TableHead>
                  <TableHead>UID</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comps.map((c) => {
                  const status = c.status ?? 'working';
                  const CompIcon = componentIcon(c.component);
                  const isOpen = openItemId === c.id;
                  return (
                    <TableRow
                      key={c.id}
                      className={cn('cursor-pointer', isOpen && 'bg-muted/50')}
                      onClick={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('input, textarea, button, a')) return;
                        onOpenItem(c.id);
                      }}
                    >
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-foreground">
                          {CompIcon ? <CompIcon size={12} strokeWidth={1.75} className="text-muted-foreground" /> : null}
                          {c.component}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <BrandGlyph text={c.specification} size={16} reserveSpace />
                          {c.specification || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">{c.ids?.uid ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <StatusBadge kind={statusKind(status)}>{status}</StatusBadge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}

function statusKind(s: string): StatusKind {
  if (s === 'working')   return 'ok';
  if (s === 'broken')    return 'bad';
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
  value, editing, onChange, placeholder = '',
  className = '', mono = false, multiline = false, muted = false, maxLength,
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
  ].filter(Boolean).join(' ');

  if (!editing) {
    const display = value.length > 0 ? value : placeholder;
    return (
      <span className={classes + (value.length === 0 ? ' is-empty' : '')}>{display}</span>
    );
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
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function slugColumn(label: string, taken: string[] = []): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'col';
  let id = base;
  let n = 2;
  while (taken.includes(id)) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

function filterMachines(machines: Machine[], q: string): Machine[] {
  if (!q) return machines;
  return machines
    .map((m) => {
      const hayName = `${m.name} ${m.role}`.toLowerCase();
      const hayMeta = m.meta.map((r) => `${r.label} ${r.value}`).join(' ').toLowerCase();
      const matchCard = hayName.includes(q) || hayMeta.includes(q);
      const components = m.components.filter((row) =>
        `${row.component} ${row.specification}`.toLowerCase().includes(q),
      );
      if (matchCard) return m;
      if (components.length === 0) return null;
      return { ...m, components };
    })
    .filter((x): x is Machine => x !== null);
}

function filterSpares(spares: SpareCategory[], q: string): SpareCategory[] {
  if (!q) return spares;
  return spares
    .map((cat) => {
      const catHit = (cat.name + ' ' + (cat.note ?? '')).toLowerCase().includes(q);
      const items = cat.items.filter((it) =>
        Object.values(it.values).join(' ').toLowerCase().includes(q),
      );
      if (catHit) return cat;
      if (items.length === 0) return null;
      return { ...cat, items };
    })
    .filter((x): x is SpareCategory => x !== null);
}
