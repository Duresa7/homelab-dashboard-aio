import type { ReactNode } from 'react';
import {
  Cpu, MemoryStick, Thermometer, HardDrive, Fan, Network, Server, Box, Disc,
} from 'lucide-react';
import { Donut } from '../components/charts';
import { GPUTile } from '../components/widgets';
import { BrandIcon } from '../components/icons/BrandIcon';
import { SectionCard, DataTableCard, StatusBadge } from '@/components/common';
import { spanClass } from '@/components/common';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DashboardState } from '../types';
import { convertTemp, fmtTemp, tempSuffix, useTempUnit, type TempUnit } from '../lib/units';

interface Props {
  data: DashboardState;
  sub: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(0)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

function tempColor(tempC: number, warnAt: number, badAt: number) {
  if (tempC >= badAt) return 'var(--bad)';
  if (tempC >= warnAt) return 'var(--warn)';
  return 'var(--ok)';
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
  icon?: ReactNode;
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

function SpinningFan({ rpm }: { rpm: number }) {
  const duration = rpm < 200 ? 0 : Math.max(0.35, Math.min(3.5, 1500 / rpm));
  return (
    <Fan
      size={12}
      strokeWidth={1.75}
      style={duration > 0 ? { animation: `icon-spin ${duration}s linear infinite`, transformOrigin: '50% 50%' } : undefined}
    />
  );
}

function throbProps(over: boolean) {
  return {
    className: over ? 'icon-throb' : '',
    style: over ? { color: 'var(--bad)' } : undefined,
  } as const;
}

function SensorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
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
  icon?: ReactNode;
  sub: string;
  tempC: number | null;
  warnAt: number;
  badAt: number;
  unit: TempUnit;
}) {
  const known = tempC != null;
  const shownTemp = known ? Math.round(convertTemp(tempC, unit)) : '—';
  const color = !known
    ? 'var(--ink-3)'
    : tempC >= badAt
      ? 'var(--bad)'
      : tempC >= warnAt
        ? 'var(--warn)'
        : 'var(--ok)';
  const statusLabel = !known
    ? 'unavailable'
    : tempC >= badAt
      ? 'hot'
      : tempC >= warnAt
        ? 'warm'
        : 'normal';
  const pillKind = !known ? 'idle' : tempC >= badAt ? 'bad' : tempC >= warnAt ? 'warn' : 'ok';
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

function MetricCard({
  title,
  icon,
  value,
  max,
  donutLabel,
  donutSub,
  primary,
  secondary,
  warn,
}: {
  title: string;
  icon?: ReactNode;
  value: number;
  max: number;
  donutLabel: string;
  donutSub: string;
  primary: string;
  secondary?: string;
  warn?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-border bg-card p-[var(--pad)] shadow-card', spanClass(3))}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="flex items-center gap-4">
        <Donut
          value={value}
          max={max}
          label={donutLabel}
          sub={donutSub}
          color={warn ? 'var(--warn)' : 'var(--accent)'}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{primary}</div>
          {secondary && <div className="text-sm text-muted-foreground">{secondary}</div>}
        </div>
      </div>
    </div>
  );
}

function Compute({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const n = data.proxmox.node;
  const threads = n.cpuThreads || 0;
  const cpusBusy = (n.cpu / 100) * threads;

  const vCpuAllocPct = threads > 0 ? (data.proxmox.coresAllocated / threads) * 100 : 0;
  const ramAllocPct = n.ramTotalGB > 0 ? (n.ramAllocatedGB / n.ramTotalGB) * 100 : 0;

  const runningCount = data.proxmox.vms.filter((v) => v.state === 'running').length;
  const totalCount = data.proxmox.vms.length;

  const fact = (label: string, value: ReactNode) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SectionCard span={12}>
        <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-wide text-muted-foreground">
              <BrandIcon name="proxmox" alt="Proxmox" /> Node
            </div>
            <div className="mt-1 font-display text-2xl font-semibold text-foreground">{n.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{n.cpuModel}</div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
            {fact('IP address', <span className="font-mono">{n.ip ?? '—'}</span>)}
            {fact('Version', `PVE ${n.version}`)}
            {fact('Uptime', n.uptime)}
            {fact(
              'Guests',
              <>
                {runningCount}
                <span className="text-muted-foreground"> running / {totalCount} total</span>
              </>,
            )}
          </div>
        </div>
      </SectionCard>

      <MetricCard
        title="CPU Usage"
        icon={<Cpu size={14} strokeWidth={1.75} {...throbProps(n.cpu > 90)} />}
        value={n.cpu}
        max={100}
        donutLabel={`${n.cpu.toFixed(1)}%`}
        donutSub={`of ${threads}`}
        primary={`${cpusBusy.toFixed(2)} of ${threads} CPUs`}
        secondary={`${n.cpu.toFixed(2)}% utilization`}
      />
      <MetricCard
        title="CPU Allocation"
        icon={<Cpu size={14} strokeWidth={1.75} {...throbProps(vCpuAllocPct > 100)} />}
        value={Math.min(vCpuAllocPct, 100)}
        max={100}
        donutLabel={`${data.proxmox.coresAllocated}`}
        donutSub={`of ${threads}`}
        primary={`${data.proxmox.coresAllocated} vCPU of ${threads}`}
        secondary={`${vCpuAllocPct.toFixed(0)}% allocated${vCpuAllocPct > 100 ? ' (overcommit)' : ''}`}
        warn={vCpuAllocPct > 100}
      />
      <MetricCard
        title="RAM Usage"
        icon={<MemoryStick size={14} strokeWidth={1.75} {...throbProps(n.ram > 90)} />}
        value={n.ram}
        max={100}
        donutLabel={`${n.ram.toFixed(0)}%`}
        donutSub="used"
        primary={`${n.ramUsedGB.toFixed(1)} of ${n.ramTotalGB.toFixed(1)} GB`}
        secondary={`${(n.ramTotalGB - n.ramUsedGB).toFixed(1)} GB free`}
        warn={n.ram > 90}
      />
      <MetricCard
        title="RAM Allocation"
        icon={<MemoryStick size={14} strokeWidth={1.75} {...throbProps(ramAllocPct > 100)} />}
        value={Math.min(ramAllocPct, 100)}
        max={100}
        donutLabel={`${ramAllocPct.toFixed(0)}%`}
        donutSub="alloc"
        primary={`${n.ramAllocatedGB.toFixed(1)} of ${n.ramTotalGB.toFixed(1)} GB`}
        secondary={`${ramAllocPct.toFixed(0)}% allocated${ramAllocPct > 100 ? ' (overcommit)' : ''}`}
        warn={ramAllocPct > 100}
      />

      <GPUTile data={data.gpu} span={12} chartKind="area" expandable={false} />

      <TempCard
        title="System Temp"
        icon={<Thermometer size={14} strokeWidth={1.75} {...throbProps((data.sensors.systemTempC ?? 0) >= 75)} />}
        sub={data.sensors.systemTempLabel ?? 'System'}
        tempC={data.sensors.systemTempC}
        warnAt={60}
        badAt={75}
        unit={unit}
      />
      <TempCard
        title="CPU Temp"
        icon={<Thermometer size={14} strokeWidth={1.75} {...throbProps((data.sensors.cpuTempC ?? 0) >= 85)} />}
        sub={n.cpuModel}
        tempC={data.sensors.cpuTempC}
        warnAt={75}
        badAt={85}
        unit={unit}
      />
      <TempCard
        title="GPU Temp"
        icon={<Thermometer size={14} strokeWidth={1.75} {...throbProps((data.gpu.tempC ?? 0) >= 85)} />}
        sub={data.gpu.model}
        tempC={data.gpu.tempC || null}
        warnAt={75}
        badAt={85}
        unit={unit}
      />
    </div>
  );
}

function Guests({ data }: { data: DashboardState }) {
  const vms = data.proxmox.vms;
  const running = vms.filter((v) => v.state === 'running').length;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <DataTableCard
        span={12}
        title="VMs & LXCs"
        sub={`${running}/${vms.length} running`}
        icon={<Server size={14} strokeWidth={1.75} />}
        isEmpty={vms.length === 0}
        empty="No virtual machines or containers detected"
        head={
          <>
            <TableHead>State</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>IP</TableHead>
            <TableHead className="text-right">CPU</TableHead>
            <TableHead className="text-right">RAM</TableHead>
            <TableHead className="text-right">Disk</TableHead>
          </>
        }
      >
        {vms.map((v) => {
          const pillKind = v.state === 'stopped' ? 'idle' : v.state === 'paused' ? 'warn' : 'ok';
          const isLxc = /lxc|ct|container/i.test(v.type);
          const TypeIcon = isLxc ? Box : Server;
          return (
            <TableRow key={v.id}>
              <TableCell>
                <StatusBadge kind={pillKind}>{v.state}</StatusBadge>
              </TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{v.id}</TableCell>
              <TableCell className="font-medium text-foreground">{v.name}</TableCell>
              <TableCell className="text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <TypeIcon size={13} strokeWidth={1.75} />
                  {v.type}
                </span>
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">{v.ip ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{v.cpu.toFixed(1)}%</TableCell>
              <TableCell className="text-right tabular-nums">{v.ram}%</TableCell>
              <TableCell className="text-right tabular-nums">{v.disk} GB</TableCell>
            </TableRow>
          );
        })}
      </DataTableCard>
    </div>
  );
}

function zfsPillKind(health: string | null): 'idle' | 'ok' | 'warn' | 'bad' {
  if (!health) return 'idle';
  const normalized = health.toUpperCase();
  if (normalized === 'ONLINE') return 'ok';
  if (normalized === 'DEGRADED') return 'warn';
  return 'bad';
}

function Storage({ data }: { data: DashboardState }) {
  const n = data.proxmox.node;
  const storages = data.proxmox.storages;
  const disks = data.proxmox.disks;
  const totalBytes = disks.reduce((sum, d) => sum + d.sizeBytes, 0);
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SectionCard
        span={4}
        title={
          <span className="flex items-center gap-1.5">
            <Disc size={14} strokeWidth={1.75} {...throbProps(n.storagePct > 90)} />
            Storage Usage
          </span>
        }
      >
        <div className="flex items-center gap-6">
          <Donut
            value={n.storagePct}
            max={100}
            label={`${n.storagePct.toFixed(0)}%`}
            sub="used"
            color={n.storagePct > 90 ? 'var(--bad)' : n.storagePct > 75 ? 'var(--warn)' : 'var(--accent)'}
          />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-medium text-foreground">
              {n.storageUsedTB.toFixed(2)} TB <span className="text-muted-foreground">of</span>{' '}
              {n.storageTotalTB.toFixed(2)} TB
            </div>
            <div className="text-sm text-muted-foreground">
              {(n.storageTotalTB - n.storageUsedTB).toFixed(2)} TB free
            </div>
          </div>
        </div>
      </SectionCard>

      <DataTableCard
        span={8}
        title="Storage Backends"
        sub={storages.length}
        icon={<Disc size={14} strokeWidth={1.75} />}
        isEmpty={storages.length === 0}
        empty="No Proxmox storage backends reported"
        head={
          <>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Content</TableHead>
            <TableHead>ZFS</TableHead>
            <TableHead className="text-right">Used</TableHead>
            <TableHead>Status</TableHead>
          </>
        }
      >
        {storages.map((s) => {
          const pct = s.totalTB > 0 ? (s.usedTB / s.totalTB) * 100 : 0;
          const zfsKind = zfsPillKind(s.zfsHealth);
          return (
            <TableRow key={s.name}>
              <TableCell className="font-mono">{s.name}</TableCell>
              <TableCell className="text-muted-foreground">{s.type}</TableCell>
              <TableCell>{s.content || <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell>
                {s.zfsHealth ? (
                  <StatusBadge kind={zfsKind}>{s.zfsHealth}</StatusBadge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{s.totalTB > 0 ? `${pct.toFixed(0)}%` : '—'}</TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <StatusBadge kind={s.active ? 'ok' : 'warn'}>{s.active ? 'active' : 'inactive'}</StatusBadge>
                  {s.shared ? (
                    <Badge variant="secondary" className="lowercase">
                      shared
                    </Badge>
                  ) : null}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </DataTableCard>

      <DataTableCard
        span={12}
        title="Physical Drives"
        sub={`${disks.length} drives · ${formatBytes(totalBytes)} total`}
        icon={<HardDrive size={14} strokeWidth={1.75} />}
        isEmpty={disks.length === 0}
        empty="No physical drives reported"
        head={
          <>
            <TableHead>Device</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead>Used by</TableHead>
            <TableHead>Health</TableHead>
            <TableHead className="text-right">Wear</TableHead>
          </>
        }
      >
        {disks.map((d) => {
          const healthOk = d.health === 'PASSED';
          const healthBad = d.health === 'FAILED';
          const typeLabel =
            d.type === 'nvme'
              ? 'NVMe'
              : d.type === 'ssd'
                ? 'SSD'
                : d.type === 'hdd'
                  ? `HDD${d.rpm > 0 ? ` · ${d.rpm} RPM` : ''}`
                  : d.type === 'usb'
                    ? 'USB'
                    : d.type.toUpperCase();
          return (
            <TableRow key={d.devpath}>
              <TableCell className="font-mono">{d.devpath}</TableCell>
              <TableCell>
                {d.vendor && <span className="text-muted-foreground">{d.vendor} </span>}
                {d.model || <span className="text-muted-foreground">unknown</span>}
              </TableCell>
              <TableCell className="text-muted-foreground">{typeLabel}</TableCell>
              <TableCell className="text-right tabular-nums">{formatBytes(d.sizeBytes)}</TableCell>
              <TableCell className="text-muted-foreground">{d.used || '—'}</TableCell>
              <TableCell className={healthOk ? 'text-ok' : healthBad ? 'text-bad' : 'text-muted-foreground'}>
                {d.health || '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {d.wearout != null ? `${d.wearout}%` : <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTableCard>
    </div>
  );
}

function Sensors({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const hasAny =
    data.sensors.disks.length > 0 ||
    data.sensors.memory.length > 0 ||
    data.sensors.network.length > 0 ||
    data.sensors.fans.some((f) => f.rpm > 0);

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SectionCard span={12} title="Hardware Sensors" icon={<Thermometer size={14} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-5">
        {!hasAny ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No hardware sensors detected</div>
        ) : (
          <>
            {data.sensors.disks.length > 0 && (
              <SensorSection title="Drives" icon={<HardDrive size={14} strokeWidth={1.75} />}>
                {data.sensors.disks.map((d) => (
                  <SensorChip key={d.name} label={d.name} value={fmtTemp(d.tempC, unit)} color={tempColor(d.tempC, 60, 70)} />
                ))}
              </SensorSection>
            )}
            {data.sensors.memory.length > 0 && (
              <SensorSection title="Memory" icon={<MemoryStick size={14} strokeWidth={1.75} />}>
                {data.sensors.memory.map((m) => (
                  <SensorChip key={m.name} label={m.name} value={fmtTemp(m.tempC, unit)} color={tempColor(m.tempC, 55, 70)} />
                ))}
              </SensorSection>
            )}
            {data.sensors.network.length > 0 && (
              <SensorSection title="Network" icon={<Network size={14} strokeWidth={1.75} />}>
                {data.sensors.network.map((nic) => (
                  <SensorChip key={nic.name} label={nic.name} value={fmtTemp(nic.tempC, unit)} color={tempColor(nic.tempC, 70, 85)} />
                ))}
              </SensorSection>
            )}
            {data.sensors.fans.some((f) => f.rpm > 0) && (
              <SensorSection title="Fans" icon={<Fan size={14} strokeWidth={1.75} className="icon-spin" />}>
                {data.sensors.fans
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
    </div>
  );
}

export function ProxmoxPage({ data, sub }: Props) {
  if (sub === 'guests')  return <Guests  data={data} />;
  if (sub === 'storage') return <Storage data={data} />;
  if (sub === 'sensors') return <Sensors data={data} />;
  return <Compute data={data} />;
}
