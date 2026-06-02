import type { ReactNode } from 'react';
import {
  Download,
  Layers,
  ListOrdered,
  Network,
  Pencil,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Upload,
} from 'lucide-react';

import { summarize, type Inventory } from '../../lib/inventory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

function MhStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-display text-xl font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
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
