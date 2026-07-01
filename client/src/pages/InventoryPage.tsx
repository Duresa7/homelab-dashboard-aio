import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  COMPONENT_TYPE_FIELDS,
  COMPONENT_TYPE_LABELS,
  detectDeviceType,
  DEVICE_BLOCKS,
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
  type DeviceCategory,
  type DeviceColumn,
  type Device,
} from '../lib/inventory';
import { canEdit, useAuth } from '../lib/auth';
import { deleteItemMedia } from '../lib/images';
import { getState, subscribe } from '../lib/store';
import { InventoryDetailPanel } from './InventoryDetailPanel';
import { toast } from 'sonner';

import { Masthead } from './inventory/Masthead';
import { MachinesTab } from './inventory/MachinesTab';
import { NetworkTab } from './inventory/NetworkTab';
import { ServiceTab } from './inventory/ServiceTab';
import { SparesTab } from './inventory/SparesTab';
import { csvCell, download, slugColumn, today, type Mode, type Tab } from './inventory/shared';

interface InventoryPageProps {
  selectedItemId?: string;
  onSelectItem?: (id: string | undefined) => void;
}

interface PersistedInventory {
  v: number;
  data: Inventory;
}

export function InventoryPage({ selectedItemId, onSelectItem }: InventoryPageProps = {}) {
  const [inv, setInv] = useState<Inventory>(() => loadInventory());
  const [tab, setTab] = useState<Tab>('machines');
  const [mode, setMode] = useState<Mode>('browse');
  const [query, setQuery] = useState('');
  const [spareFilter, setSpareFilter] = useState('all');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectItem = useCallback((id: string | undefined) => onSelectItem?.(id), [onSelectItem]);

  const didMountInv = useRef(false);
  const invRef = useRef(inv);
  const skipNextSaveRef = useRef(false);

  useEffect(() => {
    if (!didMountInv.current) {
      didMountInv.current = true;
      invRef.current = inv;
      return;
    }
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      invRef.current = inv;
      return;
    }
    invRef.current = inv;
    saveInventory(inv);
  }, [inv]);

  useEffect(
    () =>
      subscribe('inventory', () => {
        const persisted = getState<PersistedInventory | null>('inventory', null);
        if (persisted?.data === invRef.current) return;

        const next = loadInventory();
        if (next === invRef.current) return;

        invRef.current = next;
        skipNextSaveRef.current = true;
        setInv(next);
      }),
    [],
  );

  useEffect(() => {
    if (!selectedItemId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selectedItemId]);

  const stats = useMemo(() => summarize(inv), [inv]);

  const editor = canEdit(useAuth().user);
  const isEditing = mode === 'edit' && editor;
  const q = query.trim().toLowerCase();

  const patch = useCallback((mut: (draft: Inventory) => Inventory) => {
    setInv((prev) => mut(prev));
  }, []);

  const updateItemById = useCallback(
    (id: string, mut: (item: Machine | Device | Component) => Machine | Device | Component) => {
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
          devices: prev.devices.map((cat) => ({
            ...cat,
            items: cat.items.map((it) => (it.id === id ? (mut(it) as Device) : it)),
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

  const updateCategory = (id: string, mut: (c: DeviceCategory) => DeviceCategory) =>
    patch((prev) => ({
      ...prev,
      devices: prev.devices.map((c) => (c.id === id ? mut(c) : c)),
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
    patch((prev) => {
      deleteItemMedia(prev.machines.find((m) => m.id === id));
      return {
        ...prev,
        machines: prev.machines.filter((m) => m.id !== id),
        components: prev.components.map((c) =>
          c.assignment === id ? { ...c, assignment: SPARE } : c,
        ),
        lastUpdated: today(),
      };
    });
  };

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
    patch((prev) => {
      deleteItemMedia(prev.components.find((c) => c.id === id));
      return {
        ...prev,
        components: prev.components.filter((c) => c.id !== id),
        lastUpdated: today(),
      };
    });
  };

  const addCategory = () => {
    const name = prompt('Category name (e.g. "Monitors"):')?.trim();
    if (!name) return;
    const colsRaw = prompt('Column names, comma-separated:', 'Brand, Model, Notes')?.trim();
    if (!colsRaw) return;
    const columns: DeviceColumn[] = colsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ id: slugColumn(label), label }));
    if (columns.length === 0) return;
    patch((prev) => {
      const deviceType = detectDeviceType(name);
      return {
        ...prev,
        devices: [
          ...prev.devices,
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
    patch((prev) => {
      for (const item of prev.devices.find((c) => c.id === id)?.items ?? []) {
        deleteItemMedia(item);
      }
      return {
        ...prev,
        devices: prev.devices.filter((c) => c.id !== id),
        lastUpdated: today(),
      };
    });
  };

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
    if (!confirm('Reset to an empty inventory? Local changes will be lost.')) return;
    setInv(resetInventory());
    toast.success('Reset inventory');
  };

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
