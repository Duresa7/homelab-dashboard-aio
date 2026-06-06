import { useEffect, useState } from 'react';
import {
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

import { AreaChart, Donut } from '../components/charts';
import { GPUTile } from '../components/widgets';
import { ComputeWakeCard } from '@/components/proxmox/ComputeWakeCard';
import { DataTableCard, SectionCard, StatusBadge } from '@/components/common';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { convertTemp, fmtTemp, tempSuffix, useTempUnit, type TempUnit } from '../lib/units';
import type { DashboardState, ProxmoxStorage, VM } from '../types';

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

function entityKind(itemId: string): 'datacenter' | 'node' | 'guest' | 'storage' {
  if (itemId.startsWith('node/')) return 'node';
  if (itemId.startsWith('guest/')) return 'guest';
  if (itemId.startsWith('storage/')) return 'storage';
  return 'datacenter';
}

function entityName(itemId: string): string {
  return itemId.includes('/')
    ? decodeURIComponent(itemId.split('/').slice(1).join('/'))
    : 'datacenter';
}

function pct(value: number): string {
  return `${value.toFixed(0)}%`;
}

function tb(value: number): string {
  return `${value.toFixed(2)} TB`;
}

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
    <SectionCard span={6} title={title}>
      {data.length ? (
        <AreaChart data={data} height={120} color={color} />
      ) : (
        <div className="grid h-[120px] place-items-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          Waiting for history samples
        </div>
      )}
    </SectionCard>
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

function ClusterTree({ data, itemId, onSelect }: Props) {
  const shared = data.proxmox.storages.filter((s) => s.shared);
  return (
    <SectionCard span={3} title="Cluster Tree" bodyClassName="flex flex-col gap-1">
      <TreeButton
        active={itemId === 'datacenter'}
        onClick={() => onSelect('datacenter', 'summary')}
      >
        <Database size={14} /> Datacenter
      </TreeButton>
      {shared.map((s) => (
        <TreeButton
          key={`shared-${s.name}`}
          active={itemId === `storage/${encodeURIComponent(s.name)}`}
          indent
          onClick={() => onSelect(`storage/${encodeURIComponent(s.name)}`, 'summary')}
        >
          <Disc size={14} /> {s.name}
        </TreeButton>
      ))}
      {data.proxmox.nodes.map((node) => {
        const guests = data.proxmox.vms.filter((v) => v.node === node.name);
        const storages = data.proxmox.storages.filter((s) => !s.shared && s.node === node.name);
        return (
          <div key={node.name} className="mt-1 flex flex-col gap-1">
            <TreeButton
              active={itemId === `node/${encodeURIComponent(node.name)}`}
              onClick={() => onSelect(`node/${encodeURIComponent(node.name)}`, 'summary')}
            >
              <span className={`d ${node.status === 'online' ? '' : 'warn'}`} />
              <Server size={14} /> {node.name}
            </TreeButton>
            {guests.map((guest) => (
              <TreeButton
                key={guest.id}
                active={itemId === `guest/${guest.id}`}
                indent
                onClick={() => onSelect(`guest/${guest.id}`, 'summary')}
              >
                <span className={`d ${guest.state === 'running' ? '' : 'idle'}`} />
                <Box size={14} /> {guest.name}
              </TreeButton>
            ))}
            {storages.map((s) => (
              <TreeButton
                key={`${s.node}-${s.name}`}
                active={itemId === `storage/${encodeURIComponent(`${s.node}:${s.name}`)}`}
                indent
                onClick={() =>
                  onSelect(`storage/${encodeURIComponent(`${s.node}:${s.name}`)}`, 'summary')
                }
              >
                <Disc size={14} /> {s.name}
              </TreeButton>
            ))}
          </div>
        );
      })}
    </SectionCard>
  );
}

function TreeButton({
  active,
  indent,
  children,
  onClick,
}: {
  active: boolean;
  indent?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm ${
        indent ? 'ml-5' : ''
      } ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

function Stat({ title, value, icon }: { title: string; value: string; icon?: React.ReactNode }) {
  return (
    <SectionCard span={3}>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
    </SectionCard>
  );
}

function Tabs({ itemId, sub, onSelect }: Props) {
  const kind = entityKind(itemId);
  const tabs =
    kind === 'datacenter'
      ? ['summary', 'guests', 'storage']
      : kind === 'node'
        ? ['summary', 'disks', 'storage', 'network']
        : ['summary'];
  return (
    <div className="col-span-12 flex flex-wrap gap-1">
      {tabs.map((tab) => (
        <Button
          key={tab}
          variant={sub === tab ? 'default' : 'outline'}
          size="sm"
          onClick={() => onSelect(itemId, tab)}
        >
          {tab}
        </Button>
      ))}
    </div>
  );
}

function DatacenterPane({
  data,
  sub,
  windowId,
}: {
  data: DashboardState;
  sub: string;
  windowId: WindowId;
}) {
  const p = data.proxmox;
  if (sub === 'guests') return <GuestsTable vms={p.vms} showNode />;
  if (sub === 'storage') return <StorageTable storages={p.storages} />;
  return (
    <>
      <Stat
        title="Nodes"
        value={`${p.cluster.nodesOnline}/${p.cluster.nodesTotal} online`}
        icon={<Server size={14} />}
      />
      <Stat
        title="CPU"
        value={`${p.cluster.cpuUsed.toFixed(1)}/${p.cluster.cpuTotal} cores`}
        icon={<Cpu size={14} />}
      />
      <Stat
        title="RAM"
        value={`${p.cluster.memUsedGB.toFixed(1)}/${p.cluster.memTotalGB.toFixed(1)} GB`}
        icon={<MemoryStick size={14} />}
      />
      <Stat
        title="Guests"
        value={`${p.cluster.guestsRunning}/${p.cluster.guestsTotal} running`}
        icon={<Box size={14} />}
      />
      <HistoryCard
        title="Cluster CPU History"
        entity="cluster:all"
        metric="cpu_pct"
        windowId={windowId}
      />
      <HistoryCard
        title="Cluster RAM History"
        entity="cluster:all"
        metric="mem_pct"
        windowId={windowId}
        color="var(--warn)"
      />
      <GuestsTable vms={p.vms} showNode />
      <StorageTable storages={p.storages.filter((s) => s.shared)} title="Shared Storage" />
      <LocalHostPanel data={data} />
    </>
  );
}

function NodePane({
  data,
  itemId,
  sub,
  windowId,
}: {
  data: DashboardState;
  itemId: string;
  sub: string;
  windowId: WindowId;
}) {
  const nodeName = entityName(itemId);
  const node = data.proxmox.nodes.find((n) => n.name === nodeName) ?? data.proxmox.node;
  const { detail, loading, error } = useNodeDetail(itemId);
  const nodeStorages = data.proxmox.storages.filter((s) => s.node === nodeName);
  if (sub === 'storage') return <StorageTable storages={nodeStorages} />;
  if (sub === 'disks')
    return (
      <>
        <DisksTable disks={detail?.disks ?? []} loading={loading} error={error} />
        <ZfsTable pools={detail?.zfs ?? []} />
      </>
    );
  if (sub === 'network')
    return <NetworkTable networks={detail?.networks ?? []} loading={loading} error={error} />;
  return (
    <>
      <Stat title="Node" value={node.name} icon={<Server size={14} />} />
      <Stat title="CPU" value={pct(node.cpu)} icon={<Cpu size={14} />} />
      <Stat title="RAM" value={pct(node.ram)} icon={<MemoryStick size={14} />} />
      <Stat title="Uptime" value={node.uptime} icon={<Thermometer size={14} />} />
      <SectionCard span={6} title="CPU Gauge">
        <Donut value={node.cpu} max={100} label={pct(node.cpu)} sub="CPU" />
      </SectionCard>
      <SectionCard span={6} title="RAM Gauge">
        <Donut value={node.ram} max={100} label={pct(node.ram)} sub="RAM" color="var(--warn)" />
      </SectionCard>
      <HistoryCard
        title="Node CPU History"
        entity={`node:${node.name}`}
        metric="cpu_pct"
        windowId={windowId}
      />
      <HistoryCard
        title="Node RAM History"
        entity={`node:${node.name}`}
        metric="mem_pct"
        windowId={windowId}
        color="var(--warn)"
      />
    </>
  );
}

function GuestPane({
  data,
  itemId,
  windowId,
}: {
  data: DashboardState;
  itemId: string;
  windowId: WindowId;
}) {
  const guest = data.proxmox.vms.find((v) => String(v.id) === entityName(itemId));
  if (!guest) return <SectionCard span={12}>Guest not found.</SectionCard>;
  return (
    <>
      <Stat title="State" value={guest.state} icon={<Box size={14} />} />
      <Stat title="Node" value={guest.node} icon={<Server size={14} />} />
      <Stat title="CPU" value={pct(guest.cpu)} icon={<Cpu size={14} />} />
      <Stat title="RAM" value={pct(guest.ram)} icon={<MemoryStick size={14} />} />
      <Stat title="Disk" value={`${guest.disk} GB`} icon={<HardDrive size={14} />} />
      <Stat title="IP" value={guest.ip ?? 'unavailable'} />
      <HistoryCard
        title="Guest CPU History"
        entity={`guest:${guest.id}`}
        metric="cpu_pct"
        windowId={windowId}
      />
      <HistoryCard
        title="Guest RAM History"
        entity={`guest:${guest.id}`}
        metric="mem_pct"
        windowId={windowId}
        color="var(--warn)"
      />
    </>
  );
}

function StoragePane({
  data,
  itemId,
  windowId,
}: {
  data: DashboardState;
  itemId: string;
  windowId: WindowId;
}) {
  const key = entityName(itemId);
  const storage =
    data.proxmox.storages.find((s) => (s.shared ? s.name : `${s.node}:${s.name}`) === key) ??
    data.proxmox.storages.find((s) => s.name === key);
  if (!storage) return <SectionCard span={12}>Storage not found.</SectionCard>;
  const usedPct = storage.totalTB > 0 ? (storage.usedTB / storage.totalTB) * 100 : 0;
  const entity = `storage:${storage.shared ? storage.name : `${storage.node}:${storage.name}`}`;
  return (
    <>
      <Stat title="Type" value={storage.type || 'unknown'} icon={<Disc size={14} />} />
      <Stat title="Content" value={storage.content || 'none'} />
      <Stat title="Used" value={`${tb(storage.usedTB)} / ${tb(storage.totalTB)}`} />
      <Stat title="Shared" value={storage.shared ? 'yes' : 'no'} />
      <Stat title="ZFS Health" value={storage.zfsHealth ?? 'n/a'} />
      <HistoryCard
        title="Storage Used History"
        entity={entity}
        metric="used_pct"
        windowId={windowId}
      />
      <HistoryCard
        title="Storage Capacity History"
        entity={entity}
        metric="used"
        windowId={windowId}
        color="var(--warn)"
      />
      <SectionCard span={6} title="Usage">
        <Donut value={usedPct} max={100} label={pct(usedPct)} sub="used" />
      </SectionCard>
    </>
  );
}

function GuestsTable({ vms, showNode }: { vms: VM[]; showNode?: boolean }) {
  return (
    <DataTableCard
      span={12}
      title="Guests"
      sub={`${vms.filter((v) => v.state === 'running').length}/${vms.length} running`}
      isEmpty={vms.length === 0}
      empty="No virtual machines or containers detected"
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

function LocalHostPanel({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  return (
    <>
      <SectionCard span={12} bodyClassName="text-sm text-muted-foreground">
        Local host — the machine running this dashboard
      </SectionCard>
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
      <GPUTile data={data.gpu} span={12} chartKind="area" expandable={false} />
      <SensorsView data={data} />
      <ComputeWakeCard />
    </>
  );
}

export function ProxmoxPage(props: Props) {
  const [windowId, setWindowId] = useState<WindowId>('1h');
  const { data, itemId, sub } = props;
  const kind = entityKind(itemId);

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <ClusterTree {...props} />
      <div className="col-span-12 grid grid-cols-12 gap-[var(--gap)] lg:col-span-9">
        <div className="col-span-12 flex items-center justify-between gap-3">
          <Tabs {...props} />
          <WindowPicker value={windowId} onChange={setWindowId} />
        </div>
        {kind === 'datacenter' ? (
          <DatacenterPane data={data} sub={sub} windowId={windowId} />
        ) : null}
        {kind === 'node' ? (
          <NodePane data={data} itemId={itemId} sub={sub} windowId={windowId} />
        ) : null}
        {kind === 'guest' ? <GuestPane data={data} itemId={itemId} windowId={windowId} /> : null}
        {kind === 'storage' ? (
          <StoragePane data={data} itemId={itemId} windowId={windowId} />
        ) : null}
      </div>
    </div>
  );
}
