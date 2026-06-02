import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Cpu, Download, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';

import {
  componentTitle,
  loadInventory,
  SPARE,
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
import { PageHeader } from '@/components/common';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

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
    const c = inv.components.find((x) => x.id === entry.componentId);
    if (c) return componentTitle(c) || c.label;
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
    if (cat.deviceType === 'network') continue;
    if (slot.categoryMatch && !slot.categoryMatch.test(cat.name)) continue;
    for (const it of cat.items) {
      opts.push({
        value: `spare:${it.id}`,
        label: it.name?.trim() || spareLabel(it),
        group: `Spare — ${cat.name}`,
      });
    }
  }

  // Spare components from the pool (CPUs, RAM, drives, …) also fill build slots.
  if (slot.componentMatch) {
    for (const c of inv.components) {
      if (!slot.componentMatch.test(c.label)) continue;
      const where =
        c.assignment === SPARE
          ? 'Spare components'
          : `Machine — ${inv.machines.find((m) => m.id === c.assignment)?.name ?? 'unknown'}`;
      opts.push({ value: `mc:${c.id}`, label: componentTitle(c) || c.label, group: where });
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Skip initial mount; loadPlayground returned the persisted value.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    savePlayground(state);
  }, [state]);

  const patch = useCallback((mut: (draft: PlaygroundState) => PlaygroundState) => {
    setState((prev) => mut(prev));
  }, []);

  const updateBuild = useCallback(
    (id: string, mut: (b: PlaygroundBuild) => PlaygroundBuild) => {
      patch((prev) => ({
        ...prev,
        lastUpdated: today(),
        builds: prev.builds.map((b) => (b.id === id ? { ...mut(b), updatedAt: today() } : b)),
      }));
    },
    [patch],
  );

  const updateSlot = useCallback(
    (buildId: string, slotId: SlotId, mut: (e: SlotEntry) => SlotEntry) => {
      updateBuild(buildId, (b) => ({
        ...b,
        slots: { ...b.slots, [slotId]: mut(b.slots[slotId]) },
      }));
    },
    [updateBuild],
  );

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
      builds: [
        ...prev.builds,
        buildFromMachine(
          machine,
          inv.components.filter((c) => c.assignment === machine.id),
        ),
      ],
    }));
    toast.success(`Cloned ${machine.name} into a new build`);
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
    toast.success('Exported playground JSON');
  };

  const onPickImport = () => fileInputRef.current?.click();

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const parsed = tryImportPlaygroundJSON(text);
    if (!parsed) {
      toast.error('Import failed — not a valid playground file');
      return;
    }
    if (!confirm('Replace current playground with imported data?')) return;
    setState({ ...parsed, lastUpdated: today() });
    toast.success('Imported playground');
  };

  const onReset = () => {
    if (!confirm('Reset all builds to the seed example? Local changes will be lost.')) return;
    setState(resetPlayground());
    toast.success('Reset to default playground');
  };

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Build workbench"
        title="Playground"
        sub={
          <span className="font-mono tabular-nums">
            Updated {state.lastUpdated} · {state.builds.length} build
            {state.builds.length === 1 ? '' : 's'}
          </span>
        }
        actions={
          <>
            <Button size="sm" onClick={addBuild}>
              <Plus /> New build
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={inv.machines.length === 0}>
                  <Cpu /> From machine
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[60vh] w-60 overflow-y-auto">
                {inv.machines.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    className="gap-2"
                    onSelect={() => cloneFromMachine(m)}
                  >
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {m.ordinal ?? '–'}
                    </span>
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{m.role}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={onPickImport}>
              <Upload /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={onReset}>
              <RefreshCw /> Reset
            </Button>
          </>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onImportFile}
        className="hidden"
      />

      {state.builds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center text-sm text-muted-foreground shadow-card">
          No builds yet. Click <strong className="text-foreground">New build</strong> to start
          experimenting.
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

function BuildCard({
  build,
  inv,
  onChangeName,
  onChangeNotes,
  onChangeSlot,
  onDelete,
}: BuildCardProps) {
  const status = useMemo(() => computeBuildStatus(build), [build]);

  const powerBarColor = status.powerPct > 85 ? 'bad' : status.powerPct > 70 ? 'warn' : 'ok';

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-card">
      <header className="flex items-center gap-3">
        <Input
          className="h-9 max-w-xs font-display text-base font-semibold"
          value={build.name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Build name"
        />
        <div className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          created {build.createdAt} · updated {build.updatedAt}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-bad"
          onClick={onDelete}
          title="Delete build"
          aria-label="Delete build"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </header>

      <textarea
        className="min-h-[44px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        placeholder="Notes (purpose, budget, links to listings…)"
        value={build.notes ?? ''}
        onChange={(e) => onChangeNotes(e.target.value)}
        rows={2}
      />

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-44">Slot</TableHead>
              <TableHead className="w-64">Source</TableHead>
              <TableHead>Part</TableHead>
              <TableHead className="w-24 text-right">Watts</TableHead>
              <TableHead className="w-10" aria-label="Status" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {SLOT_DEFS.map((slot) => (
              <SlotRow
                key={slot.id}
                slot={slot}
                entry={build.slots[slot.id]}
                inv={inv}
                onChange={(mut) => onChangeSlot(slot.id, mut)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          {status.missing.length === 0 ? (
            <span className="text-ok">All required slots filled ✓</span>
          ) : (
            <>
              <span className="text-muted-foreground">Missing: </span>
              <span className="text-bad">
                {status.missing.map((id) => SLOT_DEFS.find((s) => s.id === id)?.label).join(', ')}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {status.psuRating === 0 ? (
            <span className="text-sm text-muted-foreground">
              Set a PSU rating to estimate the power budget
            </span>
          ) : (
            <>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {status.powerDraw} / {status.psuRating} W ({Math.round(status.powerPct)}%)
                {status.powerOk ? ' ✓' : ' — over budget'}
              </span>
              <Progress
                value={Math.min(100, status.powerPct)}
                className={cn(
                  'h-2 w-40 bg-muted',
                  powerBarColor === 'bad'
                    ? '[&>[data-slot=progress-indicator]]:bg-bad'
                    : powerBarColor === 'warn'
                      ? '[&>[data-slot=progress-indicator]]:bg-warn'
                      : '[&>[data-slot=progress-indicator]]:bg-ok',
                )}
              />
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

  const statusClass = entry.source !== 'empty' ? 'ok' : slot.required ? 'bad' : 'dim';
  const statusGlyph = entry.source !== 'empty' ? '✓' : slot.required ? '✕' : '·';

  const wattsLabel = slot.isPsu ? 'rating' : 'draw';

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">{slot.label}</span>
          {slot.isPsu ? (
            <Badge variant="secondary" className="font-mono text-[10px]">
              PSU
            </Badge>
          ) : null}
          {!slot.required ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              optional
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Select value={pickerValue} onValueChange={(v) => onChange(() => parsePickerValue(v))}>
          <SelectTrigger size="sm" className="w-full min-w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="empty">— Empty —</SelectItem>
            {[...groups.entries()].map(([group, opts]) => (
              <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {opts.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            <SelectItem value="custom">Custom text…</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {entry.source === 'custom' ? (
          <Input
            className="h-8"
            placeholder="Type a part (e.g. MSI B850 Tomahawk WiFi)"
            value={entry.customText ?? ''}
            onChange={(e) => onChange((prev) => ({ ...prev, customText: e.target.value }))}
          />
        ) : (
          <span className="text-sm text-foreground">{resolveEntryLabel(entry, inv)}</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          <Input
            type="number"
            className="h-8 w-20 text-right tabular-nums"
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
        </div>
      </TableCell>
      <TableCell className="text-center">
        <span
          className={cn(
            'text-sm',
            statusClass === 'ok'
              ? 'text-ok'
              : statusClass === 'bad'
                ? 'text-bad'
                : 'text-muted-foreground',
          )}
          aria-label={
            statusClass === 'ok' ? 'filled' : statusClass === 'bad' ? 'missing' : 'empty (optional)'
          }
        >
          {statusGlyph}
        </span>
      </TableCell>
    </TableRow>
  );
}
