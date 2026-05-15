import type { ReactNode } from 'react';
import { Donut } from '../components/charts';
import { GPUTile } from '../components/widgets';
import type { DashboardState } from '../types';
import { convertTemp, fmtTemp, tempSuffix, useTempUnit, type TempUnit } from '../lib/units';

interface Props {
  data: DashboardState;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(0)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
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
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        background: 'var(--bg-2)',
        borderRadius: 6,
        border: '1px solid var(--bg-3)',
      }}
    >
      <span className="lbl" style={{ fontSize: 11 }}>
        {label}
      </span>
      <span
        className="mono tnum"
        style={{ fontWeight: 600, fontSize: 12, color: color ?? 'var(--ink)' }}
      >
        {value}
      </span>
    </div>
  );
}

function SensorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        className="lbl"
        style={{
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </div>
  );
}

function TempCard({
  title,
  sub,
  tempC,
  warnAt,
  badAt,
  unit,
}: {
  title: string;
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
  return (
    <div className="tile span-4">
      <div className="t-title">{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
        <div
          className="tnum"
          style={{
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            color,
          }}
        >
          {shownTemp}
        </div>
        <div style={{ fontSize: 20, color: 'var(--ink-3)', fontWeight: 500 }}>
          {tempSuffix(unit)}
        </div>
      </div>
      <div className="lbl" style={{ marginTop: 8 }}>
        {sub}
      </div>
      <div className="lbl" style={{ marginTop: 2, color }}>
        {statusLabel}
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  max,
  donutLabel,
  donutSub,
  primary,
  secondary,
  warn,
}: {
  title: string;
  value: number;
  max: number;
  donutLabel: string;
  donutSub: string;
  primary: string;
  secondary?: string;
  warn?: boolean;
}) {
  return (
    <div className="tile span-3">
      <div className="t-title">{title}</div>
      <div className="metric-row" style={{ alignItems: 'center', gap: 16 }}>
        <Donut
          value={value}
          max={max}
          label={donutLabel}
          sub={donutSub}
          color={warn ? 'var(--warn)' : 'var(--accent)'}
        />
        <div className="meta flex1">
          <div className="v" style={{ fontWeight: 600 }}>{primary}</div>
          {secondary && <div className="lbl">{secondary}</div>}
        </div>
      </div>
    </div>
  );
}

export function ProxmoxPage({ data }: Props) {
  const { unit } = useTempUnit();
  const n = data.proxmox.node;
  const threads = n.cpuThreads || 0;
  const cpusBusy = (n.cpu / 100) * threads;

  const vCpuAllocPct = threads > 0 ? (data.proxmox.coresAllocated / threads) * 100 : 0;
  const ramAllocPct = n.ramTotalGB > 0 ? (n.ramAllocatedGB / n.ramTotalGB) * 100 : 0;

  const runningCount = data.proxmox.vms.filter((v) => v.state === 'running').length;
  const totalCount = data.proxmox.vms.length;

  return (
    <div className="grid">
      {/* ─── Header strip ─────────────────────────────────────────── */}
      <div className="tile span-12">
        <div
          className="metric-row"
          style={{ alignItems: 'center', gap: 32, flexWrap: 'wrap' }}
        >
          <div>
            <div className="t-title">Node</div>
            <div className="t-big" style={{ marginTop: 2 }}>{n.name}</div>
            <div className="lbl mono" style={{ marginTop: 4 }}>{n.cpuModel}</div>
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <div>
              <div className="lbl">IP address</div>
              <div className="v mono">{n.ip ?? '—'}</div>
            </div>
            <div>
              <div className="lbl">Version</div>
              <div className="v">PVE {n.version}</div>
            </div>
            <div>
              <div className="lbl">Uptime</div>
              <div className="v">{n.uptime}</div>
            </div>
            <div>
              <div className="lbl">Guests</div>
              <div className="v">
                {runningCount} <span className="muted">running</span>{' '}
                <span className="muted">/ {totalCount} total</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── CPU usage / CPU allocation ───────────────────────────── */}
      <MetricCard
        title="CPU Usage"
        value={n.cpu}
        max={100}
        donutLabel={`${n.cpu.toFixed(1)}%`}
        donutSub={`of ${threads}`}
        primary={`${cpusBusy.toFixed(2)} of ${threads} CPUs`}
        secondary={`${n.cpu.toFixed(2)}% utilization`}
      />
      <MetricCard
        title="CPU Allocation"
        value={Math.min(vCpuAllocPct, 100)}
        max={100}
        donutLabel={`${data.proxmox.coresAllocated}`}
        donutSub={`of ${threads}`}
        primary={`${data.proxmox.coresAllocated} vCPU of ${threads}`}
        secondary={`${vCpuAllocPct.toFixed(0)}% allocated${vCpuAllocPct > 100 ? ' (overcommit)' : ''}`}
        warn={vCpuAllocPct > 100}
      />

      {/* ─── RAM usage / RAM allocation ───────────────────────────── */}
      <MetricCard
        title="RAM Usage"
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
        value={Math.min(ramAllocPct, 100)}
        max={100}
        donutLabel={`${ramAllocPct.toFixed(0)}%`}
        donutSub="alloc"
        primary={`${n.ramAllocatedGB.toFixed(1)} of ${n.ramTotalGB.toFixed(1)} GB`}
        secondary={`${ramAllocPct.toFixed(0)}% allocated${ramAllocPct > 100 ? ' (overcommit)' : ''}`}
        warn={ramAllocPct > 100}
      />

      {/* ─── Storage + GPU row ─────────────────────────────────────── */}
      <div className="tile span-6">
        <div className="t-title">Storage</div>
        <div className="metric-row" style={{ alignItems: 'center', gap: 24 }}>
          <Donut
            value={n.storagePct}
            max={100}
            label={`${n.storagePct.toFixed(0)}%`}
            sub="used"
            color={n.storagePct > 90 ? 'var(--bad)' : n.storagePct > 75 ? 'var(--warn)' : 'var(--accent)'}
          />
          <div className="meta flex1">
            <div className="v" style={{ fontWeight: 600, fontSize: 18 }}>
              {n.storageUsedTB.toFixed(2)} TB <span className="muted">of</span>{' '}
              {n.storageTotalTB.toFixed(2)} TB
            </div>
            <div className="lbl">
              {(n.storageTotalTB - n.storageUsedTB).toFixed(2)} TB free across enabled storages
            </div>
          </div>
        </div>
      </div>
      <GPUTile data={data.gpu} span={6} chartKind="area" expandable={false} />

      {/* ─── Temperatures: System / CPU / GPU ──────────────────────── */}
      <TempCard
        title="System Temp"
        sub={data.sensors.systemTempLabel ?? 'motherboard / chipset'}
        tempC={data.sensors.systemTempC}
        warnAt={60}
        badAt={75}
        unit={unit}
      />
      <TempCard
        title="CPU Temp"
        sub={n.cpuModel}
        tempC={data.sensors.cpuTempC}
        warnAt={75}
        badAt={85}
        unit={unit}
      />
      <TempCard
        title="GPU Temp"
        sub={data.gpu.model}
        tempC={data.gpu.tempC || null}
        warnAt={75}
        badAt={85}
        unit={unit}
      />

      {/* ─── Hardware Sensors (drives / memory / network / fans) ──── */}
      {(data.sensors.disks.length > 0 ||
        data.sensors.memory.length > 0 ||
        data.sensors.network.length > 0 ||
        data.sensors.fans.some((f) => f.rpm > 0)) && (
        <div className="tile span-12">
          <div className="t-title">Hardware Sensors</div>

          {data.sensors.disks.length > 0 && (
            <SensorSection title="Drives">
              {data.sensors.disks.map((d) => (
                <SensorChip
                  key={d.name}
                  label={d.name}
                  value={fmtTemp(d.tempC, unit)}
                  color={tempColor(d.tempC, 60, 70)}
                />
              ))}
            </SensorSection>
          )}

          {data.sensors.memory.length > 0 && (
            <SensorSection title="Memory">
              {data.sensors.memory.map((m) => (
                <SensorChip
                  key={m.name}
                  label={m.name}
                  value={fmtTemp(m.tempC, unit)}
                  color={tempColor(m.tempC, 55, 70)}
                />
              ))}
            </SensorSection>
          )}

          {data.sensors.network.length > 0 && (
            <SensorSection title="Network">
              {data.sensors.network.map((nic) => (
                <SensorChip
                  key={nic.name}
                  label={nic.name}
                  value={fmtTemp(nic.tempC, unit)}
                  color={tempColor(nic.tempC, 70, 85)}
                />
              ))}
            </SensorSection>
          )}

          {data.sensors.fans.some((f) => f.rpm > 0) && (
            <SensorSection title="Fans">
              {data.sensors.fans
                .filter((f) => f.rpm > 0)
                .map((f) => (
                  <SensorChip
                    key={`${f.chip}-${f.name}`}
                    label={f.name}
                    value={`${Math.round(f.rpm)} RPM`}
                  />
                ))}
            </SensorSection>
          )}
        </div>
      )}

      {/* ─── Physical drives inventory ────────────────────────────── */}
      {data.proxmox.disks.length > 0 && (
        <div className="tile span-12">
          <div className="t-title">
            Drives{' '}
            <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
              ({data.proxmox.disks.length} drives ·{' '}
              {formatBytes(
                data.proxmox.disks.reduce((sum, d) => sum + d.sizeBytes, 0),
              )}{' '}
              total)
            </span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Model</th>
                <th>Type</th>
                <th className="num">Size</th>
                <th>Used by</th>
                <th>Health</th>
                <th className="num">Wear</th>
              </tr>
            </thead>
            <tbody>
              {data.proxmox.disks.map((d) => {
                const healthColor =
                  d.health === 'PASSED'
                    ? 'var(--ok)'
                    : d.health === 'FAILED'
                      ? 'var(--bad)'
                      : 'var(--ink-3)';
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
                  <tr key={d.devpath}>
                    <td className="mono">{d.devpath}</td>
                    <td>
                      {d.vendor && <span className="muted">{d.vendor} </span>}
                      {d.model || <span className="muted">unknown</span>}
                    </td>
                    <td className="muted">{typeLabel}</td>
                    <td className="mono tnum num">{formatBytes(d.sizeBytes)}</td>
                    <td className="muted">{d.used || '—'}</td>
                    <td style={{ color: healthColor }}>{d.health || '—'}</td>
                    <td className="mono tnum num">
                      {d.wearout != null ? `${d.wearout}%` : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Guests table ─────────────────────────────────────────── */}
      <div className="tile span-12">
        <div className="t-title">VMs &amp; LXCs</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>State</th>
              <th>ID</th>
              <th>Name</th>
              <th>Type</th>
              <th>IP</th>
              <th className="num">CPU</th>
              <th className="num">RAM</th>
              <th className="num">Disk</th>
            </tr>
          </thead>
          <tbody>
            {data.proxmox.vms.map((v) => {
              const cls = v.state === 'stopped' ? 'idle' : v.state === 'paused' ? 'warn' : '';
              const dotColor =
                cls === 'idle' ? 'var(--ink-4)' : cls === 'warn' ? 'var(--warn)' : 'var(--ok)';
              return (
                <tr key={v.id}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 50, background: dotColor }} />
                      {v.state}
                    </span>
                  </td>
                  <td className="mono">{v.id}</td>
                  <td>{v.name}</td>
                  <td className="muted">{v.type}</td>
                  <td className="mono">{v.ip ?? <span className="muted">—</span>}</td>
                  <td className="mono tnum num">{v.cpu.toFixed(1)}%</td>
                  <td className="mono tnum num">{v.ram}%</td>
                  <td className="mono tnum num">{v.disk} GB</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
