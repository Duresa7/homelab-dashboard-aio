import type { ReactNode } from 'react';
import { Download, ListOrdered, Pencil, RefreshCw, Search, Upload } from 'lucide-react';

import { summarize, type Inventory } from '../../lib/inventory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SubTabs, SummaryBar, type SummaryStat } from '@/components/common';

import { pad2, type Mode, type Tab } from './shared';

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

function TabLabel({ text, n }: { text: string; n: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {text}
      <span className="text-[11px] tabular-nums opacity-50">{n}</span>
    </span>
  );
}

export function Masthead({
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

  const summaryStats: SummaryStat[] = [
    { key: 'machines', label: 'Machines', value: pad2(stats.machineCount) },
    { key: 'installed', label: 'Installed parts', value: stats.installedComponentCount },
    { key: 'spare', label: 'Spare parts', value: stats.spareComponentCount },
    { key: 'devices', label: 'Devices', value: stats.deviceItemCount },
  ];

  const tabs = [
    { id: 'machines', label: <TabLabel text="Active machines" n={pad2(stats.machineCount)} /> },
    { id: 'network', label: <TabLabel text="Network" n={pad2(stats.networkItemCount)} /> },
    { id: 'service', label: <TabLabel text="In service" n={stats.installedComponentCount} /> },
    {
      id: 'devices',
      label: <TabLabel text="Spare parts" n={stats.spareComponentCount + stats.deviceItemCount} />,
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Datacenter index
          </span>
          <h1 className="font-display text-xl tracking-tight text-foreground">Inventory</h1>
          <span className="font-mono text-xs text-muted-foreground">Updated {inv.lastUpdated}</span>
        </div>

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

      <SummaryBar stats={summaryStats} />

      <SubTabs tabs={tabs} active={tab} onChange={(v) => setTab(v as Tab)} />
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
