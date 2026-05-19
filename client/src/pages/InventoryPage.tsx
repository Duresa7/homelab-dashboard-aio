import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Cpu,
  Download,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import {
  exportInventoryJSON,
  genId,
  loadInventory,
  resetInventory,
  saveInventory,
  summarize,
  tryImportInventoryJSON,
  type Inventory,
  type Machine,
  type SpareCategory,
  type SpareColumn,
} from '../lib/inventory';

type Tab = 'machines' | 'spares';
type Mode = 'browse' | 'edit';

/* =========================================================
   Page
   ========================================================= */

export function InventoryPage() {
  const [inv, setInv] = useState<Inventory>(() => loadInventory());
  const [tab, setTab] = useState<Tab>('machines');
  const [mode, setMode] = useState<Mode>('browse');
  const [query, setQuery] = useState('');
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { saveInventory(inv); }, [inv]);

  useEffect(() => {
    if (!toast) return;
    const tm = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(tm);
  }, [toast]);

  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`cat-${jumpTo}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setJumpTo(null);
  }, [jumpTo]);

  const stats = useMemo(() => summarize(inv), [inv]);
  const isEditing = mode === 'edit';
  const q = query.trim().toLowerCase();

  /* ---------- mutation helpers ---------- */

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
    patch((prev) => ({
      ...prev,
      spares: [
        ...prev.spares,
        { id: genId('cat'), name, columns, items: [] },
      ],
      lastUpdated: today(),
    }));
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

  /* ---------- export / import / reset ---------- */

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
    setToast('Exported inventory JSON');
  };

  const onPickImport = () => fileInputRef.current?.click();

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const parsed = tryImportInventoryJSON(text);
    if (!parsed) {
      setToast('Import failed — not a valid inventory file');
      return;
    }
    if (!confirm('Replace current inventory with imported data?')) return;
    setInv({ ...parsed, lastUpdated: today() });
    setToast('Imported inventory');
  };

  const onReset = () => {
    if (!confirm('Reset to default seed inventory? Local changes will be lost.')) return;
    setInv(resetInventory());
    setToast('Reset to default inventory');
  };

  /* ---------- search filtering ---------- */

  const machinesView = useMemo(() => filterMachines(inv.machines, q), [inv.machines, q]);
  const sparesView   = useMemo(() => filterSpares(inv.spares, q),     [inv.spares, q]);

  /* ---------- render ---------- */

  return (
    <div className="page inv-page">
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
        style={{ display: 'none' }}
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
        />
      ) : (
        <SparesTab
          spares={sparesView}
          isEditing={isEditing}
          updateCategory={updateCategory}
          deleteCategory={deleteCategory}
          addCategory={addCategory}
          totalCategories={inv.spares.length}
          isSearching={q.length > 0}
          onJump={setJumpTo}
        />
      )}

      {toast ? <div className="inv-toast" role="status">{toast}</div> : null}
    </div>
  );
}

/* =========================================================
   Masthead
   ========================================================= */

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

function Masthead({
  inv, stats, tab, setTab, mode, setMode, query, setQuery,
  onExport, onImport, onReset,
}: MastheadProps) {
  const isEditing = mode === 'edit';
  return (
    <section className="inv-masthead">
      <div className="inv-mh-grid">
        <div className="inv-mh-id">
          <div className="inv-mh-eyebrow">/ datacenter index</div>
          <h1 className="inv-mh-title">Inventory<span className="dot">.</span></h1>
          <div className="inv-mh-meta">
            <span className="mono">Updated {inv.lastUpdated}</span>
            <span className="sep" aria-hidden>·</span>
            <span>Single source of truth for parts &amp; spares</span>
          </div>
        </div>

        <ul className="inv-mh-stats">
          <li>
            <span className="lbl">Machines</span>
            <span className="val tnum">{pad2(stats.machineCount)}</span>
          </li>
          <li>
            <span className="lbl">Components</span>
            <span className="val tnum">{stats.componentCount}</span>
          </li>
          <li>
            <span className="lbl">Categories</span>
            <span className="val tnum">{pad2(stats.spareCategoryCount)}</span>
          </li>
          <li>
            <span className="lbl">Spare items</span>
            <span className="val tnum">{stats.spareItemCount}</span>
          </li>
        </ul>
      </div>

      <div className="inv-mh-bar">
        <div className="inv-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'machines'}
            className={`inv-tab ${tab === 'machines' ? 'is-on' : ''}`}
            onClick={() => setTab('machines')}
          >
            <Server size={13} strokeWidth={1.75} />
            Active machines
            <span className="ct tnum">{pad2(stats.machineCount)}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'spares'}
            className={`inv-tab ${tab === 'spares' ? 'is-on' : ''}`}
            onClick={() => setTab('spares')}
          >
            <Layers size={13} strokeWidth={1.75} />
            Spare parts
            <span className="ct tnum">{pad2(stats.spareCategoryCount)}</span>
          </button>
        </div>

        <div className="inv-mh-tools">
          <label className="inv-search">
            <Search size={14} strokeWidth={1.75} />
            <input
              type="search"
              placeholder={tab === 'machines'
                ? 'Filter machines, components, specs…'
                : 'Filter categories, brands, models…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="inv-search-clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={12} strokeWidth={2} />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className={`btn ${isEditing ? 'primary' : ''}`}
            onClick={() => setMode(isEditing ? 'browse' : 'edit')}
            title={isEditing ? 'Finish editing' : 'Enable inline editing'}
          >
            <Pencil size={13} strokeWidth={1.75} />
            <span>{isEditing ? 'Done editing' : 'Edit'}</span>
          </button>
          <div className="inv-mh-iconbar">
            <button type="button" className="iconbtn" onClick={onExport} title="Export JSON">
              <Download size={14} strokeWidth={1.75} />
            </button>
            <button type="button" className="iconbtn" onClick={onImport} title="Import JSON">
              <Upload size={14} strokeWidth={1.75} />
            </button>
            <button type="button" className="iconbtn" onClick={onReset} title="Reset to defaults">
              <RefreshCw size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   Machines tab
   ========================================================= */

interface MachinesTabProps {
  machines: Machine[];
  totalMachines: number;
  isEditing: boolean;
  isSearching: boolean;
  updateMachine: (id: string, mut: (m: Machine) => Machine) => void;
  deleteMachine: (id: string) => void;
  addMachine: () => void;
}

function MachinesTab({
  machines, totalMachines, isEditing, isSearching,
  updateMachine, deleteMachine, addMachine,
}: MachinesTabProps) {
  if (machines.length === 0) {
    return (
      <div className="page-empty">
        {isSearching
          ? 'No machines match the current search.'
          : 'No machines on file yet. Click “Edit” then “+ New machine” to start.'}
      </div>
    );
  }

  return (
    <div className="inv-machines">
      {machines.map((m) => (
        <MachineCard
          key={m.id}
          machine={m}
          isEditing={isEditing}
          onChange={(mut) => updateMachine(m.id, mut)}
          onDelete={() => deleteMachine(m.id)}
        />
      ))}
      {isEditing ? (
        <button type="button" className="inv-add-card" onClick={addMachine}>
          <Plus size={16} strokeWidth={1.75} />
          <span>New machine</span>
          <small>Adds a blank spec sheet (#{pad2(totalMachines + 1)})</small>
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
}

function MachineCard({ machine, isEditing, onChange, onDelete }: MachineCardProps) {
  const m = machine;

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

  return (
    <article className="inv-card">
      <header className="inv-card-head">
        <div className="inv-ordinal">
          <Editable
            value={m.ordinal ?? ''}
            editing={isEditing}
            onChange={setOrdinal}
            placeholder="##"
            className="ord"
            maxLength={4}
          />
          <span className="ord-of">/ machine</span>
        </div>
        <div className="inv-card-id">
          <Editable
            value={m.name}
            editing={isEditing}
            onChange={setName}
            placeholder="Machine name"
            className="machine-name"
          />
          <div className="machine-role">
            <Editable
              value={m.role}
              editing={isEditing}
              onChange={setRole}
              placeholder="Role"
            />
          </div>
        </div>
        {isEditing ? (
          <button
            type="button"
            className="iconbtn danger"
            onClick={onDelete}
            title="Delete machine"
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </header>

      {(m.meta.length > 0 || isEditing) ? (
        <dl className="inv-meta">
          {m.meta.map((row) => (
            <div className="inv-meta-row" key={row.id}>
              <dt>
                <Editable
                  value={row.label}
                  editing={isEditing}
                  onChange={(v) => updateMeta(row.id, 'label', v)}
                  placeholder="Label"
                />
              </dt>
              <dd>
                <Editable
                  value={row.value}
                  editing={isEditing}
                  onChange={(v) => updateMeta(row.id, 'value', v)}
                  placeholder="Value"
                  mono
                />
              </dd>
              {isEditing ? (
                <button
                  type="button"
                  className="iconbtn ghost"
                  onClick={() => removeMeta(row.id)}
                  title="Remove meta row"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              ) : null}
            </div>
          ))}
          {isEditing ? (
            <button type="button" className="inv-add-row" onClick={addMeta}>
              <Plus size={12} strokeWidth={2} /> meta row
            </button>
          ) : null}
        </dl>
      ) : null}

      <section className="inv-spec">
        <div className="inv-spec-head">
          <Cpu size={12} strokeWidth={1.75} />
          <span>Components</span>
          <span className="ct mono">{m.components.length}</span>
        </div>
        <ul className="inv-spec-list">
          {m.components.map((row) => (
            <li key={row.id} className="inv-spec-row">
              <div className="inv-spec-label">
                <Editable
                  value={row.component}
                  editing={isEditing}
                  onChange={(v) => updateComp(row.id, 'component', v)}
                  placeholder="Component"
                />
              </div>
              <div className="inv-spec-val">
                <Editable
                  value={row.specification}
                  editing={isEditing}
                  onChange={(v) => updateComp(row.id, 'specification', v)}
                  placeholder="Specification"
                  multiline
                />
              </div>
              {isEditing ? (
                <button
                  type="button"
                  className="iconbtn ghost"
                  onClick={() => removeComp(row.id)}
                  title="Remove component"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {isEditing ? (
          <button type="button" className="inv-add-row" onClick={addComp}>
            <Plus size={12} strokeWidth={2} /> component
          </button>
        ) : null}
      </section>
    </article>
  );
}

/* =========================================================
   Spares tab
   ========================================================= */

interface SparesTabProps {
  spares: SpareCategory[];
  totalCategories: number;
  isEditing: boolean;
  isSearching: boolean;
  updateCategory: (id: string, mut: (c: SpareCategory) => SpareCategory) => void;
  deleteCategory: (id: string) => void;
  addCategory: () => void;
  onJump: (id: string) => void;
}

function SparesTab({
  spares, totalCategories, isEditing, isSearching,
  updateCategory, deleteCategory, addCategory, onJump,
}: SparesTabProps) {
  if (spares.length === 0) {
    return (
      <div className="page-empty">
        {isSearching
          ? 'No spare-part categories match the current search.'
          : 'No spare-part categories yet. Click “Edit” then “+ New category” to start.'}
      </div>
    );
  }

  return (
    <div className="inv-spares">
      <nav className="inv-jump">
        <span className="inv-jump-lbl">Jump to</span>
        <div className="inv-jump-chips">
          {spares.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className="inv-jump-chip"
              onClick={() => onJump(cat.id)}
            >
              {cat.name}
              <span className="ct tnum">{cat.items.length}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="inv-cats">
        {spares.map((cat) => (
          <CategoryBlock
            key={cat.id}
            category={cat}
            isEditing={isEditing}
            onChange={(mut) => updateCategory(cat.id, mut)}
            onDelete={() => deleteCategory(cat.id)}
          />
        ))}
        {isEditing ? (
          <button type="button" className="inv-add-card wide" onClick={addCategory}>
            <Plus size={16} strokeWidth={1.75} />
            <span>New category</span>
            <small>Define a name and column headers (#{pad2(totalCategories + 1)})</small>
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
}

function CategoryBlock({ category, isEditing, onChange, onDelete }: CategoryBlockProps) {
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

  const addItem = () =>
    onChange((cur) => ({
      ...cur,
      items: [...cur.items, { id: genId('s'), values: {} }],
    }));

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

  return (
    <section className="inv-cat" id={`cat-${category.id}`}>
      <header className="inv-cat-head">
        <div className="inv-cat-id">
          <h3>
            <Editable
              value={category.name}
              editing={isEditing}
              onChange={setName}
              placeholder="Category name"
            />
          </h3>
          <span className="inv-cat-count tnum mono">{pad2(category.items.length)} item{category.items.length === 1 ? '' : 's'}</span>
        </div>
        {isEditing ? (
          <div className="inv-cat-actions">
            <button type="button" className="iconbtn ghost" onClick={addColumn} title="Add column">
              <Plus size={12} strokeWidth={2} /> col
            </button>
            <button type="button" className="iconbtn danger" onClick={onDelete} title="Delete category">
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          </div>
        ) : null}
      </header>

      {(category.note || isEditing) ? (
        <div className="inv-cat-note">
          <Editable
            value={category.note ?? ''}
            editing={isEditing}
            onChange={setNote}
            placeholder="Optional note for this category"
            muted
          />
        </div>
      ) : null}

      <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              {category.columns.map((col) => (
                <th key={col.id} className={col.align === 'right' ? 'num' : ''}>
                  <div className="inv-th-inner">
                    <Editable
                      value={col.label}
                      editing={isEditing}
                      onChange={(v) => setColumnLabel(col.id, v)}
                      placeholder="Column"
                      className="th-edit"
                    />
                    {isEditing ? (
                      <button
                        type="button"
                        className="iconbtn ghost"
                        onClick={() => removeColumn(col.id)}
                        title="Remove column"
                      >
                        <X size={11} strokeWidth={2} />
                      </button>
                    ) : null}
                  </div>
                </th>
              ))}
              {isEditing ? <th className="inv-th-actions" aria-label="Row actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {category.items.length === 0 ? (
              <tr>
                <td
                  colSpan={category.columns.length + (isEditing ? 1 : 0)}
                  className="inv-empty-cell"
                >
                  No items in this category yet.
                </td>
              </tr>
            ) : null}
            {category.items.map((it) => (
              <tr key={it.id}>
                {category.columns.map((col) => (
                  <td key={col.id} className={col.align === 'right' ? 'num' : ''}>
                    <Editable
                      value={it.values[col.id] ?? ''}
                      editing={isEditing}
                      onChange={(v) => setItemValue(it.id, col.id, v)}
                      placeholder="—"
                      mono={col.id === 'model' || col.id === 'part' || col.align === 'right'}
                    />
                  </td>
                ))}
                {isEditing ? (
                  <td className="inv-td-actions">
                    <button
                      type="button"
                      className="iconbtn ghost"
                      onClick={() => removeItem(it.id)}
                      title="Remove row"
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isEditing ? (
        <button type="button" className="inv-add-row stretch" onClick={addItem}>
          <Plus size={12} strokeWidth={2} /> add item
        </button>
      ) : null}
    </section>
  );
}

/* =========================================================
   Inline editable text
   ========================================================= */

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

function Editable({
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

/* =========================================================
   Helpers
   ========================================================= */

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

