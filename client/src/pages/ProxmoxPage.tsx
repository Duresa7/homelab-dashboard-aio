import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Box,
  Cpu,
  Database,
  Disc,
  Fan,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  Thermometer,
} from 'lucide-react';

import { AreaChart } from '../components/charts';
import { GPUTile } from '../components/widgets';
import {
  ChartCard,
  DataTableCard,
  EntityCard,
  MiniGauge,
  SectionCard,
  Segmented,
  StatList,
  StatRow,
  StatusBadge,
  SubTabs,
  SummaryBar,
  type EntityMetric,
  type StatTone,
  type SummaryStat,
} from '@/components/common';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { entityName } from '../lib/route';
import { getState, setState } from '../lib/store';
import { cpuUsageSeverity, fillSeverity, ramUsageSeverity } from '../lib/severity';
import { convertTemp, fmtTemp, tempSuffix, useTempUnit, type TempUnit } from '../lib/units';
import type {
  DashboardState,
  PhysicalDisk,
  ProxmoxClusterNode,
  ProxmoxNode,
  ProxmoxStorage,
  Severity,
  VM,
} from '../types';

interface Props {
  data: DashboardState;
  itemId: string;
  sub: string;
  onSelect: (itemId: string, sub?: string) => void;
}

interface NodeDetail {
  status?: Record<string, unknown>;
  disks: Record<string, unknown>[];
  zfs: Record<string, unknown>[];
  networks: Record<string, unknown>[];
  storages: Record<string, unknown>[];
}

type WindowId = '1h' | '6h' | '24h' | '48h';

const WINDOW_MS: Record<WindowId, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
};

const DC_TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'guests', label: 'Guests' },
  { id: 'storage', label: 'Storage' },
  { id: 'disks', label: 'Disks' },
  { id: 'sensors', label: 'Sensors' },
];

const NODE_TABS = [
  { id: 'summary', label: 'Overview' },
  { id: 'disks', label: 'Disks / ZFS' },
  { id: 'storage', label: 'Storage' },
  { id: 'network', label: 'Network' },
];

function entityKind(itemId: string): 'datacenter' | 'node' | 'guest' | 'storage' {
  if (itemId.startsWith('node/')) return 'node';
  if (itemId.startsWith('guest/')) return 'guest';
  if (itemId.startsWith('storage/')) return 'storage';
  return 'datacenter';
}

function pct(value: number): string {
  return `${value.toFixed(0)}%`;
}

function tb(value: number): string {
  return `${value.toFixed(2)} TB`;
}

/** Severity → StatCard/SummaryBar tone, leaving "ok" neutral so color = meaning. */
function tone(sev: Severity): StatTone {
  return sev === 'ok' ? 'default' : sev;
}

type ProxmoxNodeSummary = ProxmoxClusterNode | ProxmoxNode;

function nodeStatusKind(node: { status?: string }): 'ok' | 'bad' {
  const online = node.status ? node.status === 'online' : true;
  return online ? 'ok' : 'bad';
}

// ---------------------------------------------------------------------------
// Data hooks (unchanged behavior)
// ---------------------------------------------------------------------------

function useNodeDetail(itemId: string): {
  detail: NodeDetail | null;
  loading: boolean;
  error: string | null;
} {
  const node = itemId.startsWith('node/') ? entityName(itemId) : null;
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!node) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/proxmox/node/${encodeURIComponent(node)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setDetail(json);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message || err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node]);

  return { detail, loading, error };
}

function useHistory(entity: string, metric: string, windowId: WindowId): number[] {
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    let cancelled = false;
    const to = Date.now();
    const from = to - WINDOW_MS[windowId];
    fetch(
      `/api/proxmox/history?entity=${encodeURIComponent(entity)}&metric=${encodeURIComponent(metric)}&from=${from}&to=${to}&points=96`,
    )
      .then((res) => (res.ok ? res.json() : { series: [] }))
      .then((json) => {
        if (!cancelled) setSeries((json.series ?? []).map((p: { v: number }) => Number(p.v)));
      })
      .catch(() => {
        if (!cancelled) setSeries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entity, metric, windowId]);
  return series;
}

function HistoryCard({
  title,
  entity,
  metric,
  windowId,
  color,
}: {
  title: string;
  entity: string;
  metric: string;
  windowId: WindowId;
  color?: string;
}) {
  const data = useHistory(entity, metric, windowId);
  return (
    <ChartCard title={title} span={6} height={120} isEmpty={data.length === 0}>
      <AreaChart data={data} height={120} color={color} showBounds />
    </ChartCard>
  );
}

function WindowPicker({
  value,
  onChange,
}: {
  value: WindowId;
  onChange: (value: WindowId) => void;
}) {
  return (
    <div className="flex gap-1">
      {(Object.keys(WINDOW_MS) as WindowId[]).map((id) => (
        <Button
          key={id}
          size="sm"
          variant={value === id ? 'default' : 'outline'}
          onClick={() => onChange(id)}
        >
          {id}
        </Button>
      ))}
    </div>
  );
}

/** Section heading inside the 12-col grid. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-12 -mb-1 flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </div>
  );
}

/** Back affordance + title + status for drill-in detail views. */
function DetailHeader({
  onBack,
  backLabel,
  title,
  status,
  statusLabel,
  icon,
}: {
  onBack: () => void;
  backLabel: string;
  title: string;
  status?: 'ok' | 'warn' | 'bad' | 'idle';
  statusLabel?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="col-span-12 flex flex-wrap items-center gap-3">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 gap-1.5 text-muted-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" />
        {backLabel}
      </Button>
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
        <span className="truncate font-display text-lg font-semibold tracking-tight text-foreground">
          {title}
        </span>
        {statusLabel ? <StatusBadge kind={status ?? 'idle'}>{statusLabel}</StatusBadge> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cluster summary + node cards
// ---------------------------------------------------------------------------

function clusterStats(data: DashboardState): SummaryStat[] {
  const c = data.proxmox.cluster;
  return [
    {
      key: 'nodes',
      label: 'Nodes',
      value: `${c.nodesOnline}/${c.nodesTotal}`,
      sub: 'online',
      tone: c.nodesOnline < c.nodesTotal ? 'warn' : 'default',
      icon: <Server />,
    },
    {
      key: 'cpu',
      label: 'CPU',
      value: pct(c.cpuPct),
      sub: `${c.cpuUsed.toFixed(0)}/${c.cpuTotal} cores`,
      tone: tone(cpuUsageSeverity(c.cpuPct)),
      icon: <Cpu />,
    },
    {
      key: 'mem',
      label: 'Memory',
      value: pct(c.memPct),
      sub: `${c.memUsedGB.toFixed(0)}/${c.memTotalGB.toFixed(0)} GB`,
      tone: tone(ramUsageSeverity(c.memPct)),
      icon: <MemoryStick />,
    },
    {
      key: 'storage',
      label: 'Storage',
      value: pct(c.storagePct),
      sub: `${c.storageUsedTB.toFixed(1)}/${c.storageTotalTB.toFixed(1)} TB`,
      tone: tone(fillSeverity(c.storagePct)),
      icon: <Database />,
    },
    {
      key: 'guests',
      label: 'Guests',
      value: `${c.guestsRunning}/${c.guestsTotal}`,
      sub: 'running',
      icon: <Box />,
    },
  ];
}

function nodeStoragePct(node: ProxmoxNodeSummary): number {
  return 'storagePct' in node ? node.storagePct : node.disk;
}

function nodeStorageUsedTB(node: ProxmoxNodeSummary): number {
  return 'storageUsedTB' in node ? node.storageUsedTB : node.diskUsedTB;
}

function nodeStorageTotalTB(node: ProxmoxNodeSummary): number {
  return 'storageTotalTB' in node ? node.storageTotalTB : node.diskTotalTB;
}

function nodeMetrics(node: ProxmoxNodeSummary): EntityMetric[] {
  const storagePct = nodeStoragePct(node);
  return [
    { key: 'cpu', label: 'CPU', pct: node.cpu, tone: cpuUsageSeverity(node.cpu) },
    {
      key: 'ram',
      label: 'RAM',
      pct: node.ram,
      tone: ramUsageSeverity(node.ram),
      value: `${node.ramUsedGB.toFixed(0)}/${node.ramTotalGB.toFixed(0)} GB`,
    },
    {
      key: 'disk',
      label: 'Disk',
      pct: storagePct,
      tone: fillSeverity(storagePct),
      value: `${nodeStorageUsedTB(node).toFixed(1)}/${nodeStorageTotalTB(node).toFixed(1)} TB`,
    },
  ];
}

function NodesGrid({ data, onSelect }: { data: DashboardState; onSelect: Props['onSelect'] }) {
  const nodes = data.proxmox.nodes;
  if (nodes.length === 0) {
    return (
      <SectionCard span={12} bodyClassName="py-8 text-center text-sm text-muted-foreground">
        No Proxmox nodes detected
      </SectionCard>
    );
  }
  return (
    <>
      <SectionLabel>
        <Server className="size-3.5" /> Nodes · {nodes.length}
      </SectionLabel>
      {nodes.map((node) => {
        const guests = data.proxmox.vms.filter((v) => v.node === node.name);
        const running = guests.filter((v) => v.state === 'running').length;
        const kind = nodeStatusKind(node);
        return (
          <EntityCard
            key={node.name}
            span={4}
            name={node.name}
            subtitle={node.level ?? 'Proxmox node'}
            icon={<Server />}
            status={kind}
            statusLabel={node.status ?? 'online'}
            metrics={nodeMetrics(node)}
            meta={[
              { key: 'guests', value: `${running}/${guests.length} guests` },
              { key: 'uptime', value: `↑ ${node.uptime}` },
              { key: 'ip', value: '—' },
            ]}
            onClick={() => onSelect(`node/${encodeURIComponent(node.name)}`, 'summary')}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Datacenter view
// ---------------------------------------------------------------------------

function DatacenterView({
  data,
  sub,
  windowId,
  setWindowId,
  onSelect,
}: {
  data: DashboardState;
  sub: string;
  windowId: WindowId;
  setWindowId: (w: WindowId) => void;
  onSelect: Props['onSelect'];
}) {
  const p = data.proxmox;
  const showWindow = sub === 'summary';
  return (
    <>
      <SubTabs
        tabs={DC_TABS}
        active={sub}
        onChange={(id) => onSelect('datacenter', id)}
        actions={showWindow ? <WindowPicker value={windowId} onChange={setWindowId} /> : undefined}
      />
      {sub === 'guests' && <GuestsView vms={p.vms} />}
      {sub === 'storage' && <StorageTables storages={p.storages} />}
      {sub === 'disks' && <ClusterDisksTable disks={p.disks} />}
      {sub === 'sensors' && <SensorsTab data={data} />}
      {sub === 'summary' && (
        <>
          <SummaryBar stats={clusterStats(data)} />
          <NodesGrid data={data} onSelect={onSelect} />
          <SectionLabel>Cluster history</SectionLabel>
          <HistoryCard title="CPU" entity="cluster:all" metric="cpu_pct" windowId={windowId} />
          <HistoryCard
            title="Memory"
            entity="cluster:all"
            metric="mem_pct"
            windowId={windowId}
            color="var(--warn)"
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Node view (drill-in)
// ---------------------------------------------------------------------------

function NodeView({
  data,
  itemId,
  sub,
  windowId,
  setWindowId,
  onSelect,
}: {
  data: DashboardState;
  itemId: string;
  sub: string;
  windowId: WindowId;
  setWindowId: (w: WindowId) => void;
  onSelect: Props['onSelect'];
}) {
  const nodeName = entityName(itemId);
  const clusterNode = data.proxmox.nodes.find((n) => n.name === nodeName);
  const node: ProxmoxNodeSummary =
    clusterNode?.name === data.proxmox.node.name
      ? data.proxmox.node
      : (clusterNode ?? data.proxmox.node);
  const { detail, loading, error } = useNodeDetail(itemId);
  const nodeStorages = data.proxmox.storages.filter((s) => s.node === nodeName);
  const guests = data.proxmox.vms.filter((v) => v.node === nodeName);
  const running = guests.filter((v) => v.state === 'running').length;
  const kind = nodeStatusKind(node);
  const cpuModel = 'cpuModel' in node ? node.cpuModel : '—';
  const cpuCores = 'cpuCores' in node ? node.cpuCores : node.maxcpu;
  const cpuThreads = 'cpuThreads' in node ? node.cpuThreads : node.maxcpu;
  const nodeIp = 'ip' in node ? node.ip : null;
  const nodeVersion = 'version' in node ? node.version : '—';
  const nodeHasHardware =
    data.gpus.some((g) => g.node === nodeName) ||
    data.sensorNodes.some((s) => s.node === nodeName) ||
    data.gpuUnavailable.some((u) => u.node === nodeName) ||
    data.sensorsUnavailable.some((u) => u.node === nodeName);

  return (
    <>
      <DetailHeader
        onBack={() => onSelect('datacenter', 'summary')}
        backLabel="Data Center"
        title={node.name}
        icon={<Server />}
        status={kind}
        statusLabel={node.status ?? 'online'}
      />
      <SubTabs
        tabs={NODE_TABS}
        active={sub}
        onChange={(id) => onSelect(itemId, id)}
        actions={
          sub === 'summary' ? <WindowPicker value={windowId} onChange={setWindowId} /> : undefined
        }
      />
      {sub === 'storage' && <StorageTable storages={nodeStorages} />}
      {sub === 'disks' && (
        <>
          <DisksTable disks={detail?.disks ?? []} loading={loading} error={error} />
          <ZfsTable pools={detail?.zfs ?? []} />
        </>
      )}
      {sub === 'network' && (
        <NetworkTable networks={detail?.networks ?? []} loading={loading} error={error} />
      )}
      {sub === 'summary' && (
        <>
          <SectionCard span={4} title="CPU" icon={<Cpu size={14} strokeWidth={1.75} />}>
            <div className="grid place-items-center py-1">
              <MiniGauge value={node.cpu} sub="CPU" tone={cpuUsageSeverity(node.cpu)} size={120} />
            </div>
          </SectionCard>
          <SectionCard span={4} title="Memory" icon={<MemoryStick size={14} strokeWidth={1.75} />}>
            <div className="grid place-items-center py-1">
              <MiniGauge value={node.ram} sub="RAM" tone={ramUsageSeverity(node.ram)} size={120} />
            </div>
            <div className="mt-1 text-center text-xs text-muted-foreground tabular-nums">
              {node.ramUsedGB.toFixed(1)} / {node.ramTotalGB.toFixed(1)} GB
            </div>
          </SectionCard>
          <SectionCard span={4} title="Node" icon={<Server size={14} strokeWidth={1.75} />}>
            <StatList>
              <StatRow label="CPU" value={cpuModel} />
              <StatRow label="Cores / threads" value={`${cpuCores} / ${cpuThreads}`} />
              <StatRow
                label="Storage"
                value={`${tb(nodeStorageUsedTB(node))} / ${tb(nodeStorageTotalTB(node))}`}
              />
              <StatRow label="Guests" value={`${running}/${guests.length} running`} />
              <StatRow label="IP" value={nodeIp ?? '—'} />
              <StatRow label="Uptime" value={node.uptime} />
              <StatRow label="Version" value={nodeVersion} />
            </StatList>
          </SectionCard>
          <HistoryCard
            title="CPU history"
            entity={`node:${node.name}`}
            metric="cpu_pct"
            windowId={windowId}
          />
          <HistoryCard
            title="Memory history"
            entity={`node:${node.name}`}
            metric="mem_pct"
            windowId={windowId}
            color="var(--warn)"
          />
          {nodeHasHardware ? <NodeHardwareCard data={data} nodeName={node.name} span={12} /> : null}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Guest + storage detail (drill-in)
// ---------------------------------------------------------------------------

function GuestView({
  data,
  itemId,
  windowId,
  setWindowId,
  onSelect,
}: {
  data: DashboardState;
  itemId: string;
  windowId: WindowId;
  setWindowId: (w: WindowId) => void;
  onSelect: Props['onSelect'];
}) {
  const guest = data.proxmox.vms.find((v) => String(v.id) === entityName(itemId));
  if (!guest) {
    return (
      <SectionCard span={12} bodyClassName="py-8 text-center text-sm text-muted-foreground">
        Guest not found.
      </SectionCard>
    );
  }
  const kind = guest.state === 'running' ? 'ok' : 'idle';
  return (
    <>
      <DetailHeader
        onBack={() => onSelect('datacenter', 'guests')}
        backLabel="Data Center"
        title={guest.name}
        icon={<Box />}
        status={kind}
        statusLabel={guest.state}
      />
      <div className="col-span-12 flex justify-end">
        <WindowPicker value={windowId} onChange={setWindowId} />
      </div>
      <SectionCard span={4} title="CPU" icon={<Cpu size={14} strokeWidth={1.75} />}>
        <div className="grid place-items-center py-1">
          <MiniGauge value={guest.cpu} sub="CPU" tone={cpuUsageSeverity(guest.cpu)} size={120} />
        </div>
      </SectionCard>
      <SectionCard span={4} title="Memory" icon={<MemoryStick size={14} strokeWidth={1.75} />}>
        <div className="grid place-items-center py-1">
          <MiniGauge value={guest.ram} sub="RAM" tone={ramUsageSeverity(guest.ram)} size={120} />
        </div>
      </SectionCard>
      <SectionCard span={4} title="Guest" icon={<Box size={14} strokeWidth={1.75} />}>
        <StatList>
          <StatRow label="Type" value={guest.type} />
          <StatRow label="Node" value={guest.node} />
          <StatRow label="Disk" value={`${guest.disk} GB`} />
          <StatRow label="IP" value={guest.ip ?? 'unavailable'} />
        </StatList>
      </SectionCard>
      <HistoryCard
        title="CPU history"
        entity={`guest:${guest.id}`}
        metric="cpu_pct"
        windowId={windowId}
      />
      <HistoryCard
        title="Memory history"
        entity={`guest:${guest.id}`}
        metric="mem_pct"
        windowId={windowId}
        color="var(--warn)"
      />
    </>
  );
}

function StorageView({
  data,
  itemId,
  windowId,
  setWindowId,
  onSelect,
}: {
  data: DashboardState;
  itemId: string;
  windowId: WindowId;
  setWindowId: (w: WindowId) => void;
  onSelect: Props['onSelect'];
}) {
  const key = entityName(itemId);
  const storage =
    data.proxmox.storages.find((s) => (s.shared ? s.name : `${s.node}:${s.name}`) === key) ??
    data.proxmox.storages.find((s) => s.name === key);
  if (!storage) {
    return (
      <SectionCard span={12} bodyClassName="py-8 text-center text-sm text-muted-foreground">
        Storage not found.
      </SectionCard>
    );
  }
  const usedPct = storage.totalTB > 0 ? (storage.usedTB / storage.totalTB) * 100 : 0;
  const entity = `storage:${storage.shared ? storage.name : `${storage.node}:${storage.name}`}`;
  return (
    <>
      <DetailHeader
        onBack={() => onSelect('datacenter', 'storage')}
        backLabel="Data Center"
        title={storage.name}
        icon={<Disc />}
      />
      <div className="col-span-12 flex justify-end">
        <WindowPicker value={windowId} onChange={setWindowId} />
      </div>
      <SectionCard span={4} title="Usage" icon={<Disc size={14} strokeWidth={1.75} />}>
        <div className="grid place-items-center py-1">
          <MiniGauge value={usedPct} sub="used" tone={fillSeverity(usedPct)} size={120} />
        </div>
      </SectionCard>
      <SectionCard span={8} title="Storage" icon={<Database size={14} strokeWidth={1.75} />}>
        <StatList>
          <StatRow label="Type" value={storage.type || 'unknown'} />
          <StatRow label="Content" value={storage.content || 'none'} />
          <StatRow label="Used" value={`${tb(storage.usedTB)} / ${tb(storage.totalTB)}`} />
          <StatRow label="Shared" value={storage.shared ? 'yes' : 'no'} />
          <StatRow label="ZFS health" value={storage.zfsHealth ?? 'n/a'} />
        </StatList>
      </SectionCard>
      <HistoryCard title="Used history" entity={entity} metric="used_pct" windowId={windowId} />
      <HistoryCard
        title="Capacity history"
        entity={entity}
        metric="used"
        windowId={windowId}
        color="var(--warn)"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

type TableView = 'combined' | 'per-node';

/** Combined-vs-per-node table preference, persisted per table via /api/state. */
function useTableView(key: string): [TableView, (v: TableView) => void] {
  const [view, setView] = useState<TableView>(() =>
    getState<TableView>(key, 'combined') === 'per-node' ? 'per-node' : 'combined',
  );
  const set = (v: TableView) => {
    setView(v);
    setState<TableView>(key, v);
  };
  return [view, set];
}

const VIEW_OPTIONS = [
  { value: 'combined', label: 'combined' },
  { value: 'per-node', label: 'per node' },
];

function GuestsView({ vms }: { vms: VM[] }) {
  const [query, setQuery] = useState('');
  const [nodeFilter, setNodeFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [view, setView] = useTableView('guestsTableView');

  const nodes = [...new Set(vms.map((v) => v.node))];
  const multiNode = nodes.length > 1;

  const q = query.trim().toLowerCase();
  let filtered = vms;
  if (q) {
    filtered = filtered.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        String(v.id).includes(q) ||
        (v.ip ?? '').toLowerCase().includes(q) ||
        v.node.toLowerCase().includes(q),
    );
  }
  if (nodeFilter !== 'all') filtered = filtered.filter((v) => v.node === nodeFilter);
  if (stateFilter !== 'all') filtered = filtered.filter((v) => v.state === stateFilter);

  const perNode = multiNode && view === 'per-node';
  const visibleNodes = nodes.filter((n) => nodeFilter === 'all' || n === nodeFilter);

  return (
    <>
      <SectionCard span={12} title="Filter" sub={`${filtered.length} of ${vms.length} guests`}>
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex w-56 flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">search</span>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="name, ID, node or IP"
            />
          </div>
          {multiNode && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">node</span>
              <Segmented
                value={nodeFilter}
                onChange={setNodeFilter}
                options={[
                  { value: 'all', label: 'all' },
                  ...nodes.map((n) => ({ value: n, label: n })),
                ]}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">state</span>
            <Segmented
              value={stateFilter}
              onChange={setStateFilter}
              options={[
                { value: 'all', label: 'all' },
                { value: 'running', label: 'running' },
                { value: 'stopped', label: 'stopped' },
              ]}
            />
          </div>
          {multiNode && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">view</span>
              <Segmented
                value={view}
                onChange={(v) => setView(v as TableView)}
                options={VIEW_OPTIONS}
              />
            </div>
          )}
        </div>
      </SectionCard>

      {perNode ? (
        visibleNodes.map((n) => (
          <GuestsTable
            key={n}
            vms={filtered.filter((v) => v.node === n)}
            title={`Guests · ${n}`}
            empty="No guests match the current filters"
          />
        ))
      ) : (
        <GuestsTable
          vms={filtered}
          showNode
          empty={vms.length === 0 ? undefined : 'No guests match the current filters'}
        />
      )}
    </>
  );
}

function StorageTables({ storages }: { storages: ProxmoxStorage[] }) {
  const [view, setView] = useTableView('storageTableView');
  // Shared storages are cluster-wide, so the per-node view groups them apart.
  const groups = [...new Set(storages.map((s) => (s.shared ? 'Shared' : s.node)))];
  const multiNode = groups.length > 1;

  return (
    <>
      {multiNode && (
        <SectionCard span={12} title="View" sub={`${storages.length} storages`}>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">view</span>
            <Segmented
              value={view}
              onChange={(v) => setView(v as TableView)}
              options={VIEW_OPTIONS}
            />
          </div>
        </SectionCard>
      )}
      {multiNode && view === 'per-node' ? (
        groups.map((g) => (
          <StorageTable
            key={g}
            title={g === 'Shared' ? 'Storage · shared' : `Storage · ${g}`}
            storages={storages.filter((s) => (s.shared ? 'Shared' : s.node) === g)}
          />
        ))
      ) : (
        <StorageTable storages={storages} />
      )}
    </>
  );
}

function GuestsTable({
  vms,
  showNode,
  title = 'Guests',
  empty = 'No virtual machines or containers detected',
}: {
  vms: VM[];
  showNode?: boolean;
  title?: string;
  empty?: string;
}) {
  return (
    <DataTableCard
      span={12}
      title={title}
      sub={`${vms.filter((v) => v.state === 'running').length}/${vms.length} running`}
      isEmpty={vms.length === 0}
      empty={empty}
      head={
        <>
          <TableHead>State</TableHead>
          <TableHead>ID</TableHead>
          <TableHead>Name</TableHead>
          {showNode ? <TableHead>Node</TableHead> : null}
          <TableHead>IP</TableHead>
          <TableHead className="text-right">CPU</TableHead>
          <TableHead className="text-right">RAM</TableHead>
        </>
      }
    >
      {vms.map((v) => (
        <TableRow key={v.id}>
          <TableCell>
            <StatusBadge kind={v.state === 'running' ? 'ok' : 'idle'}>{v.state}</StatusBadge>
          </TableCell>
          <TableCell className="font-mono">{v.id}</TableCell>
          <TableCell>{v.name}</TableCell>
          {showNode ? <TableCell>{v.node}</TableCell> : null}
          <TableCell className="font-mono">{v.ip ?? '—'}</TableCell>
          <TableCell className="text-right">{pct(v.cpu)}</TableCell>
          <TableCell className="text-right">{pct(v.ram)}</TableCell>
        </TableRow>
      ))}
    </DataTableCard>
  );
}

function StorageTable({
  storages,
  title = 'Storage',
}: {
  storages: ProxmoxStorage[];
  title?: string;
}) {
  return (
    <DataTableCard
      span={12}
      title={title}
      sub={storages.length}
      isEmpty={storages.length === 0}
      empty="No storage pools reported"
      head={
        <>
          <TableHead>Name</TableHead>
          <TableHead>Node</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Content</TableHead>
          <TableHead>Shared</TableHead>
          <TableHead>ZFS</TableHead>
          <TableHead className="text-right">Used</TableHead>
        </>
      }
    >
      {storages.map((s) => (
        <TableRow key={`${s.node}-${s.name}`}>
          <TableCell className="font-mono">{s.name}</TableCell>
          <TableCell>{s.node}</TableCell>
          <TableCell>{s.type}</TableCell>
          <TableCell>{s.content || '—'}</TableCell>
          <TableCell>{s.shared ? 'yes' : 'no'}</TableCell>
          <TableCell>{s.zfsHealth ?? '—'}</TableCell>
          <TableCell className="text-right">
            {s.totalTB > 0 ? pct((s.usedTB / s.totalTB) * 100) : '—'}
          </TableCell>
        </TableRow>
      ))}
    </DataTableCard>
  );
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(0)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${n} B`;
}

function str(v: unknown, fallback = '—'): string {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return fallback;
  return String(v);
}

/** Cluster-wide physical disks from the live state (no per-node fetch). */
function ClusterDisksTable({ disks }: { disks: PhysicalDisk[] }) {
  return (
    <DataTableCard
      span={12}
      title="Physical Disks"
      sub={`${disks.length} drives`}
      icon={<HardDrive size={14} strokeWidth={1.75} />}
      isEmpty={disks.length === 0}
      empty="No physical disks reported"
      head={
        <>
          <TableHead>Device</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Health</TableHead>
          <TableHead className="text-right">Wear</TableHead>
        </>
      }
    >
      {disks.map((d, i) => (
        <TableRow key={d.devpath || String(i)}>
          <TableCell className="font-mono">{d.devpath || '—'}</TableCell>
          <TableCell>{d.model || '—'}</TableCell>
          <TableCell className="text-muted-foreground">
            {(d.type || '').toUpperCase() || '—'}
          </TableCell>
          <TableCell className="text-right tabular-nums">{fmtBytes(d.sizeBytes)}</TableCell>
          <TableCell>{d.health ?? '—'}</TableCell>
          <TableCell className="text-right tabular-nums">
            {typeof d.wearout === 'number' ? `${d.wearout}%` : '—'}
          </TableCell>
        </TableRow>
      ))}
    </DataTableCard>
  );
}

function DisksTable({
  disks,
  loading,
  error,
}: {
  disks: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <DataTableCard
      span={12}
      title="Physical Disks"
      sub={loading ? 'loading' : `${disks.length} drives`}
      icon={<HardDrive size={14} strokeWidth={1.75} />}
      isEmpty={!loading && disks.length === 0}
      empty={error ?? 'No physical disks reported'}
      head={
        <>
          <TableHead>Device</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Health</TableHead>
          <TableHead className="text-right">Wear</TableHead>
        </>
      }
    >
      {disks.map((d, i) => (
        <TableRow key={str(d.devpath, String(i))}>
          <TableCell className="font-mono">{str(d.devpath)}</TableCell>
          <TableCell>{str(d.model)}</TableCell>
          <TableCell className="text-muted-foreground">{str(d.type).toUpperCase()}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtBytes(Number(d.size))}</TableCell>
          <TableCell>{str(d.health)}</TableCell>
          <TableCell className="text-right tabular-nums">
            {typeof d.wearout === 'number' ? `${d.wearout}%` : '—'}
          </TableCell>
        </TableRow>
      ))}
    </DataTableCard>
  );
}

function ZfsTable({ pools }: { pools: Record<string, unknown>[] }) {
  if (!pools.length) return null;
  return (
    <DataTableCard
      span={12}
      title="ZFS Pools"
      sub={`${pools.length} pools`}
      icon={<Disc size={14} strokeWidth={1.75} />}
      isEmpty={false}
      head={
        <>
          <TableHead>Pool</TableHead>
          <TableHead>Health</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead className="text-right">Alloc</TableHead>
          <TableHead className="text-right">Free</TableHead>
        </>
      }
    >
      {pools.map((z, i) => (
        <TableRow key={str(z.name, String(i))}>
          <TableCell className="font-mono">{str(z.name)}</TableCell>
          <TableCell>{str(z.health)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtBytes(Number(z.size))}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtBytes(Number(z.alloc))}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtBytes(Number(z.free))}</TableCell>
        </TableRow>
      ))}
    </DataTableCard>
  );
}

function NetworkTable({
  networks,
  loading,
  error,
}: {
  networks: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <DataTableCard
      span={12}
      title="Network Interfaces"
      sub={loading ? 'loading' : `${networks.length} interfaces`}
      icon={<Network size={14} strokeWidth={1.75} />}
      isEmpty={!loading && networks.length === 0}
      empty={error ?? 'No network interfaces reported'}
      head={
        <>
          <TableHead>Interface</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Active</TableHead>
          <TableHead>Address</TableHead>
        </>
      }
    >
      {networks.map((n, i) => (
        <TableRow key={str(n.iface, String(i))}>
          <TableCell className="font-mono">{str(n.iface)}</TableCell>
          <TableCell className="text-muted-foreground">{str(n.type)}</TableCell>
          <TableCell>{n.active ? 'yes' : 'no'}</TableCell>
          <TableCell className="font-mono">{str(n.address ?? n.cidr)}</TableCell>
        </TableRow>
      ))}
    </DataTableCard>
  );
}

// ---------------------------------------------------------------------------
// Sensors tab (local host hardware)
// ---------------------------------------------------------------------------

function tempColor(tempC: number, warnAt: number, badAt: number) {
  if (tempC >= badAt) return 'var(--bad)';
  if (tempC >= warnAt) return 'var(--warn)';
  return 'var(--ok)';
}

function throbProps(over: boolean) {
  return {
    className: over ? 'icon-throb' : '',
    style: over ? { color: 'var(--bad)' } : undefined,
  } as const;
}

function SpinningFan({ rpm }: { rpm: number }) {
  const duration = rpm < 200 ? 0 : Math.max(0.35, Math.min(3.5, 1500 / rpm));
  return (
    <Fan
      size={12}
      strokeWidth={1.75}
      style={
        duration > 0
          ? { animation: `icon-spin ${duration}s linear infinite`, transformOrigin: '50% 50%' }
          : undefined
      }
    />
  );
}

function SensorChip({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-sm">
      {icon ? <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span> : null}
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

function SensorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <span className="[&_svg]:size-3.5">{icon}</span>
        {title}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function TempCard({
  title,
  icon,
  sub,
  tempC,
  warnAt,
  badAt,
  unit,
}: {
  title: string;
  icon?: React.ReactNode;
  sub: string;
  tempC: number | null;
  warnAt: number;
  badAt: number;
  unit: TempUnit;
}) {
  const shownTemp = tempC == null ? '—' : Math.round(convertTemp(tempC, unit));
  const color =
    tempC == null
      ? 'var(--ink-3)'
      : tempC >= badAt
        ? 'var(--bad)'
        : tempC >= warnAt
          ? 'var(--warn)'
          : 'var(--ok)';
  const statusLabel =
    tempC == null ? 'unavailable' : tempC >= badAt ? 'hot' : tempC >= warnAt ? 'warm' : 'normal';
  const pillKind =
    tempC == null ? 'idle' : tempC >= badAt ? 'bad' : tempC >= warnAt ? 'warn' : 'ok';
  return (
    <SectionCard
      span={4}
      title={
        <span className="flex items-center gap-1.5">
          {icon}
          {title}
        </span>
      }
      actions={<StatusBadge kind={pillKind}>{statusLabel}</StatusBadge>}
    >
      <div className="flex items-baseline gap-1">
        <span
          className="font-mono text-[56px] leading-none font-semibold tracking-tight tabular-nums"
          style={{ color }}
        >
          {shownTemp}
        </span>
        <span className="text-[22px] font-medium text-muted-foreground">{tempSuffix(unit)}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </SectionCard>
  );
}

function SensorsView({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const s = data.sensors;
  const hasAny =
    s.disks.length > 0 ||
    s.memory.length > 0 ||
    s.network.length > 0 ||
    s.fans.some((f) => f.rpm > 0);
  return (
    <SectionCard
      span={12}
      title="Hardware Sensors"
      icon={<Thermometer size={14} strokeWidth={1.75} />}
      bodyClassName="flex flex-col gap-5"
    >
      {!hasAny ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No hardware sensors detected
        </div>
      ) : (
        <>
          {s.disks.length > 0 && (
            <SensorSection title="Drives" icon={<HardDrive size={14} strokeWidth={1.75} />}>
              {s.disks.map((d) => (
                <SensorChip
                  key={d.name}
                  label={d.name}
                  value={fmtTemp(d.tempC, unit)}
                  color={tempColor(d.tempC, 60, 70)}
                />
              ))}
            </SensorSection>
          )}
          {s.memory.length > 0 && (
            <SensorSection title="Memory" icon={<MemoryStick size={14} strokeWidth={1.75} />}>
              {s.memory.map((m) => (
                <SensorChip
                  key={m.name}
                  label={m.name}
                  value={fmtTemp(m.tempC, unit)}
                  color={tempColor(m.tempC, 55, 70)}
                />
              ))}
            </SensorSection>
          )}
          {s.network.length > 0 && (
            <SensorSection title="Network" icon={<Network size={14} strokeWidth={1.75} />}>
              {s.network.map((nic) => (
                <SensorChip
                  key={nic.name}
                  label={nic.name}
                  value={fmtTemp(nic.tempC, unit)}
                  color={tempColor(nic.tempC, 70, 85)}
                />
              ))}
            </SensorSection>
          )}
          {s.fans.some((f) => f.rpm > 0) && (
            <SensorSection
              title="Fans"
              icon={<Fan size={14} strokeWidth={1.75} className="icon-spin" />}
            >
              {s.fans
                .filter((f) => f.rpm > 0)
                .map((f) => (
                  <SensorChip
                    key={`${f.chip}-${f.name}`}
                    label={f.name}
                    value={`${Math.round(f.rpm)} RPM`}
                    icon={<SpinningFan rpm={f.rpm} />}
                  />
                ))}
            </SensorSection>
          )}
        </>
      )}
    </SectionCard>
  );
}

/**
 * Per-node hardware summary — one node's GPU(s) and CPU/system temps, clearly
 * attributed to that node. Used by the Sensors tab's per-node breakdown and by
 * a single node's detail view, so GPU/temps are never ambiguous across nodes.
 */
export function NodeHardwareCard({
  data,
  nodeName,
  span = 4,
}: {
  data: DashboardState;
  nodeName: string;
  span?: number;
}) {
  const { unit } = useTempUnit();
  const gpus = data.gpus.filter((g) => g.node === nodeName);
  const sensors = data.sensorNodes.find((s) => s.node === nodeName) ?? null;
  const unavailable =
    data.gpuUnavailable.find((u) => u.node === nodeName) ??
    data.sensorsUnavailable.find((u) => u.node === nodeName) ??
    null;
  return (
    <SectionCard
      span={span}
      title={
        <span className="flex items-center gap-1.5">
          <Server size={14} strokeWidth={1.75} />
          {nodeName}
        </span>
      }
      actions={unavailable ? <StatusBadge kind="warn">unavailable</StatusBadge> : undefined}
    >
      <StatList>
        {gpus.length ? (
          gpus.map((g) => (
            <StatRow
              key={g.index}
              label={`GPU ${g.index}`}
              value={`${g.model} · ${Math.round(g.usage)}% · ${fmtTemp(g.tempC, unit)}`}
            />
          ))
        ) : (
          <StatRow label="GPU" value="No GPU" />
        )}
        <StatRow
          label="CPU temp"
          value={
            sensors && sensors.cpuTempC != null
              ? fmtTemp(sensors.cpuTempC, unit)
              : sensors
                ? '—'
                : 'No sensors'
          }
        />
        <StatRow
          label="System temp"
          value={sensors && sensors.systemTempC != null ? fmtTemp(sensors.systemTempC, unit) : '—'}
        />
      </StatList>
    </SectionCard>
  );
}

/** The Sensors-tab per-node breakdown — only shown for multi-node clusters. */
function PerNodeHardware({ data }: { data: DashboardState }) {
  if (data.proxmox.nodes.length <= 1) return null;
  return (
    <>
      {data.proxmox.nodes.map((n) => (
        <NodeHardwareCard key={n.name} data={data} nodeName={n.name} />
      ))}
    </>
  );
}

function SensorsTab({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  return (
    <>
      <TempCard
        title="System Temp"
        icon={
          <Thermometer
            size={14}
            strokeWidth={1.75}
            {...throbProps((data.sensors.systemTempC ?? 0) >= 75)}
          />
        }
        sub={data.sensors.systemTempLabel ?? 'System'}
        tempC={data.sensors.systemTempC}
        warnAt={60}
        badAt={75}
        unit={unit}
      />
      <TempCard
        title="CPU Temp"
        icon={
          <Thermometer
            size={14}
            strokeWidth={1.75}
            {...throbProps((data.sensors.cpuTempC ?? 0) >= 85)}
          />
        }
        sub={data.proxmox.node.cpuModel}
        tempC={data.sensors.cpuTempC}
        warnAt={75}
        badAt={85}
        unit={unit}
      />
      <TempCard
        title="GPU Temp"
        icon={
          <Thermometer size={14} strokeWidth={1.75} {...throbProps((data.gpu.tempC ?? 0) >= 85)} />
        }
        sub={data.gpu.model}
        tempC={data.gpu.tempC || null}
        warnAt={75}
        badAt={85}
        unit={unit}
      />
      <GPUTile data={data.gpu} span={12} chartKind="area" />
      <PerNodeHardware data={data} />
      <SensorsView data={data} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ProxmoxPage({ data, itemId, sub, onSelect }: Props) {
  const [windowId, setWindowId] = useState<WindowId>('1h');
  const kind = entityKind(itemId);

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      {kind === 'datacenter' && (
        <DatacenterView
          data={data}
          sub={sub}
          windowId={windowId}
          setWindowId={setWindowId}
          onSelect={onSelect}
        />
      )}
      {kind === 'node' && (
        <NodeView
          data={data}
          itemId={itemId}
          sub={sub}
          windowId={windowId}
          setWindowId={setWindowId}
          onSelect={onSelect}
        />
      )}
      {kind === 'guest' && (
        <GuestView
          data={data}
          itemId={itemId}
          windowId={windowId}
          setWindowId={setWindowId}
          onSelect={onSelect}
        />
      )}
      {kind === 'storage' && (
        <StorageView
          data={data}
          itemId={itemId}
          windowId={windowId}
          setWindowId={setWindowId}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}
