import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Cpu,
  Database,
  Disc,
  HardDrive,
  MemoryStick,
  Server,
  Thermometer,
} from 'lucide-react';

import { AreaChart, Donut } from '../components/charts';
import { DataTableCard, SectionCard, StatusBadge } from '@/components/common';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
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
        ? ['summary', 'disks', 'storage', 'sensors']
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
        entity={`node:${p.node.name}`}
        metric="cpu_pct"
        windowId={windowId}
      />
      <HistoryCard
        title="Cluster RAM History"
        entity={`node:${p.node.name}`}
        metric="mem_pct"
        windowId={windowId}
        color="var(--warn)"
      />
      <GuestsTable vms={p.vms} showNode />
      <StorageTable storages={p.storages.filter((s) => s.shared)} title="Shared Storage" />
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
      <NodeDetailTable
        title="Disks / ZFS"
        rows={[...(detail?.disks ?? []), ...(detail?.zfs ?? [])]}
        loading={loading}
        error={error}
      />
    );
  if (sub === 'sensors')
    return (
      <NodeDetailTable
        title="Networks / Sensors"
        rows={detail?.networks ?? []}
        loading={loading}
        error={error}
      />
    );
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

function NodeDetailTable({
  title,
  rows,
  loading,
  error,
}: {
  title: string;
  rows: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
}) {
  const keys = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 6),
    [rows],
  );
  return (
    <DataTableCard
      span={12}
      title={title}
      sub={loading ? 'loading' : rows.length}
      isEmpty={!loading && rows.length === 0}
      empty={error ?? 'No node detail reported'}
      head={
        <>
          {keys.map((key) => (
            <TableHead key={key}>{key}</TableHead>
          ))}
        </>
      }
    >
      {rows.map((row, index) => (
        <TableRow key={index}>
          {keys.map((key) => (
            <TableCell key={key}>{String(row[key] ?? '—')}</TableCell>
          ))}
        </TableRow>
      ))}
    </DataTableCard>
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
