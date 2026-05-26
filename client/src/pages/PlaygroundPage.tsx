import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  Cpu,
  Download,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';

import {
  loadInventory,
  type Inventory,
  type Machine,
  type SpareItem,
} from '../lib/inventory';
import {
  SLOT_DEFS,
  buildFromMachine,
  computeBuildStatus,
  emptyBuild,
  exportPlaygroundJSON,
  loadPlayground,
  resetPlayground,
  savePlayground,
  tryImportPlaygroundJSON,
  type PlaygroundBuild,
  type PlaygroundState,
  type SlotDef,
  type SlotEntry,
  type SlotId,
} from '../lib/playground';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function spareLabel(item: SpareItem): string {
  const brand = item.values.brand ?? '';
  const model = item.values.model ?? item.values.part ?? '';
  return [brand, model].filter(Boolean).join(' ') || 'Spare item';
}

function resolveEntryLabel(entry: SlotEntry, inv: Inventory): string {
  if (entry.source === 'empty') return '—';
  if (entry.source === 'custom') return entry.customText?.trim() || '(custom)';
  if (entry.source === 'spare' && entry.spareId) {
    for (const cat of inv.spares) {
      const it = cat.items.find((x) => x.id === entry.spareId);
      if (it) return spareLabel(it);
    }
    return '(missing spare)';
  }
  if (entry.source === 'machine-component' && entry.componentId) {
    for (const m of inv.machines) {
      const c = m.components.find((x) => x.id === entry.componentId);
      if (c) return c.specification || c.component;
    }
    return '(missing component)';
  }
  return '—';
}

interface PickerOption {
  value: string;
  label: string;
  group: string;
}

function buildPickerOptions(slot: SlotDef, inv: Inventory): PickerOption[] {
  const opts: PickerOption[] = [];

  // Spare-parts options, filtered by category regex if defined; otherwise everything.
  for (const cat of inv.spares) {
    if (cat.kind === 'network') continue;
    if (slot.categoryMatch && !slot.categoryMatch.test(cat.name)) continue;
    for (const it of cat.items) {
      opts.push({
        value: `spare:${it.id}`,
        label: spareLabel(it),
        group: `Spare — ${cat.name}`,
      });
    }
  }

  // Machine-component options for slots that match a component-name regex.
  if (slot.componentMatch) {
    for (const m of inv.machines) {
      for (const c of m.components) {
        if (slot.componentMatch.test(c.component)) {
          opts.push({
            value: `mc:${c.id}`,
            label: c.specification || c.component,
            group: `Machine — ${m.name}`,
          });
        }
      }
    }
  }

  return opts;
}

function entryPickerValue(entry: SlotEntry): string {
  if (entry.source === 'spare' && entry.spareId) return `spare:${entry.spareId}`;
  if (entry.source === 'machine-component' && entry.componentId) return `mc:${entry.componentId}`;
  if (entry.source === 'custom') return 'custom';
  return 'empty';
}

function parsePickerValue(v: string): SlotEntry {
  if (v === 'empty') return { source: 'empty' };
  if (v === 'custom') return { source: 'custom', customText: '' };
  if (v.startsWith('spare:')) return { source: 'spare', spareId: v.slice(6) };
  if (v.startsWith('mc:')) return { source: 'machine-component', componentId: v.slice(3) };
  return { source: 'empty' };
}

export function PlaygroundPage() {
  const [state, setState] = useState<PlaygroundState>(() => loadPlayground());
  const [inv] = useState<Inventory>(() => loadInventory());
  const [toast, setToast] = useState<string | null>(null);
  const [showMachinePicker, setShowMachinePicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Skip initial mount; loadPlayground returned the persisted value.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    savePlayground(state);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const tm = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(tm);
  }, [toast]);

  const patch = useCallback((mut: (draft: PlaygroundState) => PlaygroundState) => {
    setState((prev) => mut(prev));
  }, []);

  const updateBuild = useCallback((id: string, mut: (b: PlaygroundBuild) => PlaygroundBuild) => {
    patch((prev) => ({
      ...prev,
      lastUpdated: today(),
      builds: prev.builds.map((b) =>
        b.id === id ? { ...mut(b), updatedAt: today() } : b,
      ),
    }));
  }, [patch]);

  const updateSlot = useCallback((buildId: string, slotId: SlotId, mut: (e: SlotEntry) => SlotEntry) => {
    updateBuild(buildId, (b) => ({
      ...b,
      slots: { ...b.slots, [slotId]: mut(b.slots[slotId]) },
    }));
  }, [updateBuild]);

  const addBuild = () => {
    patch((prev) => ({
      ...prev,
      lastUpdated: today(),
      builds: [...prev.builds, emptyBuild(`Build ${prev.builds.length + 1}`)],
    }));
  };

  const cloneFromMachine = (machine: Machine) => {
    patch((prev) => ({
      ...prev,
      lastUpdated: today(),
      builds: [...prev.builds, buildFromMachine(machine)],
    }));
    setShowMachinePicker(false);
    setToast(`Cloned ${machine.name} into a new build`);
  };

  const deleteBuild = (id: string) => {
    if (!confirm('Delete this build?')) return;
    patch((prev) => ({
      ...prev,
      lastUpdated: today(),
      builds: prev.builds.filter((b) => b.id !== id),
    }));
  };

  const onExport = () => {
    const json = exportPlaygroundJSON(state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `homelab-playground-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast('Exported playground JSON');
  };

  const onPickImport = () => fileInputRef.current?.click();

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const parsed = tryImportPlaygroundJSON(text);
    if (!parsed) {
      setToast('Import failed — not a valid playground file');
      return;
    }
    if (!confirm('Replace current playground with imported data?')) return;
    setState({ ...parsed, lastUpdated: today() });
    setToast('Imported playground');
  };

  const onReset = () => {
    if (!confirm('Reset all builds to the seed example? Local changes will be lost.')) return;
    setState(resetPlayground());
    setToast('Reset to default playground');
  };

  return (
    <div className="page pg-page">
      <section className="pg-mh">
        <div className="pg-mh-id">
          <div className="pg-mh-eyebrow">/ build workbench</div>
          <h1 className="pg-mh-title">Playground<span className="dot">.</span></h1>
          <div className="pg-mh-meta">
            <span className="mono">Updated {state.lastUpdated}</span>
            <span className="mono"> · {state.builds.length} build{state.builds.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div className="pg-mh-tools">
          <button className="btn" onClick={addBuild}>
            <Plus size={14} /> New build
          </button>
          <div className="pg-machine-wrap">
            <button
              className="btn"
              onClick={() => setShowMachinePicker((v) => !v)}
              disabled={inv.machines.length === 0}
            >
              <Cpu size={14} /> From machine
            </button>
            {showMachinePicker ? (
              <div className="pg-machine-menu" role="menu">
                {inv.machines.map((m) => (
                  <button key={m.id} className="pg-machine-item" onClick={() => cloneFromMachine(m)}>
                    <span className="mono ord">{m.ordinal ?? '–'}</span>
                    <span className="nm">{m.name}</span>
                    <span className="role">{m.role}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className="btn" onClick={onExport}>
            <Download size={14} /> Export
          </button>
          <button className="btn" onClick={onPickImport}>
            <Upload size={14} /> Import
          </button>
          <button className="btn" onClick={onReset}>
            <RefreshCw size={14} /> Reset
          </button>
        </div>
      </section>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onImportFile}
        style={{ display: 'none' }}
      />

      {state.builds.length === 0 ? (
        <div className="page-empty">
          No builds yet. Click <strong>New build</strong> to start experimenting.
        </div>
      ) : (
        state.builds.map((build) => (
          <BuildCard
            key={build.id}
            build={build}
            inv={inv}
            onChangeName={(name) => updateBuild(build.id, (b) => ({ ...b, name }))}
            onChangeNotes={(notes) => updateBuild(build.id, (b) => ({ ...b, notes }))}
            onChangeSlot={(slotId, mut) => updateSlot(build.id, slotId, mut)}
            onDelete={() => deleteBuild(build.id)}
          />
        ))
      )}

      {toast ? <div className="inv-toast" role="status">{toast}</div> : null}
    </div>
  );
}

interface BuildCardProps {
  build: PlaygroundBuild;
  inv: Inventory;
  onChangeName: (name: string) => void;
  onChangeNotes: (notes: string) => void;
  onChangeSlot: (slotId: SlotId, mut: (e: SlotEntry) => SlotEntry) => void;
  onDelete: () => void;
}

function BuildCard({ build, inv, onChangeName, onChangeNotes, onChangeSlot, onDelete }: BuildCardProps) {
  const status = useMemo(() => computeBuildStatus(build), [build]);

  const powerBarColor =
    status.powerPct > 85 ? 'bad' :
    status.powerPct > 70 ? 'warn' : 'ok';

  return (
    <section className="pg-card">
      <header className="pg-card-head">
        <input
          className="pg-name"
          value={build.name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Build name"
        />
        <div className="pg-stamps mono">
          <span>created {build.createdAt}</span>
          <span> · updated {build.updatedAt}</span>
        </div>
        <button className="pg-icon-btn danger" onClick={onDelete} title="Delete build" aria-label="Delete build">
          <Trash2 size={14} />
        </button>
      </header>

      <textarea
        className="pg-notes"
        placeholder="Notes (purpose, budget, links to listings…)"
        value={build.notes ?? ''}
        onChange={(e) => onChangeNotes(e.target.value)}
        rows={2}
      />

      <table className="pg-slots">
        <thead>
          <tr>
            <th className="col-slot">Slot</th>
            <th className="col-source">Source</th>
            <th className="col-label">Part</th>
            <th className="col-watts">Watts</th>
            <th className="col-status" aria-label="Status" />
          </tr>
        </thead>
        <tbody>
          {SLOT_DEFS.map((slot) => {
            const entry = build.slots[slot.id];
            return (
              <SlotRow
                key={slot.id}
                slot={slot}
                entry={entry}
                inv={inv}
                onChange={(mut) => onChangeSlot(slot.id, mut)}
              />
            );
          })}
        </tbody>
      </table>

      <footer className="pg-card-foot">
        <div className="pg-missing">
          {status.missing.length === 0 ? (
            <span className="ok">All required slots filled ✓</span>
          ) : (
            <>
              <span className="lbl">Missing:</span>{' '}
              <span className="bad">
                {status.missing.map((id) => SLOT_DEFS.find((s) => s.id === id)?.label).join(', ')}
              </span>
            </>
          )}
        </div>
        <div className="pg-power">
          {status.psuRating === 0 ? (
            <span className="dim">Set a PSU rating to estimate the power budget</span>
          ) : (
            <>
              <span className="pg-power-text mono">
                {status.powerDraw} / {status.psuRating} W ({Math.round(status.powerPct)}%)
                {status.powerOk ? ' ✓' : ' — over budget'}
              </span>
              <div className={`pg-bar ${powerBarColor}`}>
                <div className="fill" style={{ width: `${Math.min(100, status.powerPct)}%` }} />
              </div>
            </>
          )}
        </div>
      </footer>
    </section>
  );
}

interface SlotRowProps {
  slot: SlotDef;
  entry: SlotEntry;
  inv: Inventory;
  onChange: (mut: (e: SlotEntry) => SlotEntry) => void;
}

function SlotRow({ slot, entry, inv, onChange }: SlotRowProps) {
  const options = useMemo(() => buildPickerOptions(slot, inv), [slot, inv]);
  const groups = useMemo(() => {
    const out = new Map<string, PickerOption[]>();
    for (const o of options) {
      if (!out.has(o.group)) out.set(o.group, []);
      out.get(o.group)!.push(o);
    }
    return out;
  }, [options]);

  const pickerValue = entryPickerValue(entry);

  const statusClass =
    entry.source !== 'empty' ? 'ok' :
    slot.required ? 'bad' : 'dim';
  const statusGlyph =
    entry.source !== 'empty' ? '✓' :
    slot.required ? '✕' : '·';

  const wattsLabel = slot.isPsu ? 'rating' : 'draw';

  return (
    <tr>
      <td className="col-slot">
        <span className="pg-slot-name">{slot.label}</span>
        {slot.isPsu ? <span className="pg-slot-tag mono">PSU</span> : null}
        {!slot.required ? <span className="pg-slot-tag mono dim">optional</span> : null}
      </td>
      <td className="col-source">
        <select
          className="pg-select"
          value={pickerValue}
          onChange={(e) => onChange(() => parsePickerValue(e.target.value))}
        >
          <option value="empty">— Empty —</option>
          {[...groups.entries()].map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
          <option value="custom">Custom text…</option>
        </select>
      </td>
      <td className="col-label">
        {entry.source === 'custom' ? (
          <input
            className="pg-custom-input"
            placeholder="Type a part (e.g. MSI B850 Tomahawk WiFi)"
            value={entry.customText ?? ''}
            onChange={(e) => onChange((prev) => ({ ...prev, customText: e.target.value }))}
          />
        ) : (
          <span className="pg-part-label">{resolveEntryLabel(entry, inv)}</span>
        )}
      </td>
      <td className="col-watts">
        <input
          type="number"
          className="pg-watts"
          inputMode="numeric"
          min={0}
          placeholder={slot.isPsu ? '850' : '—'}
          value={entry.watts ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange((prev) => ({
              ...prev,
              watts: raw === '' ? undefined : Math.max(0, Number(raw) || 0),
            }));
          }}
          aria-label={`${slot.label} ${wattsLabel} in watts`}
        />
      </td>
      <td className={`col-status ${statusClass}`} aria-label={statusClass === 'ok' ? 'filled' : statusClass === 'bad' ? 'missing' : 'empty (optional)'}>
        {statusGlyph}
      </td>
    </tr>
  );
}

