import { Database, Fan, HardDrive, ShieldCheck, Thermometer } from 'lucide-react';
import { SmartTile } from '../components/widgets';
import {
  DataTableCard,
  EntityCard,
  SectionCard,
  StatCard,
  StatList,
  StatRow,
  StatusBadge,
  SubTabs,
} from '@/components/common';
import { TableCell, TableHead } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { fillSeverity } from '../lib/severity';
import type { DashboardState, UnasPool } from '../types';
import { fmtTemp, useTempUnit } from '../lib/units';
import { formatPowerOnTime } from '../lib/format';

interface Props {
  data: DashboardState;
  sub: string;
  onSelectSub: (sub: string) => void;
}

const NAS_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'pools', label: 'Pools' },
  { id: 'disks', label: 'Disks' },
];

function poolStatus(status: string): 'ok' | 'warn' | 'bad' {
  if (/degraded|offline|error|fault/i.test(status)) return 'bad';
  if (/resilver|scrub|rebuild|warn/i.test(status)) return 'warn';
  return 'ok';
}

function Overview({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const nas = data.unas;
  const pools = nas.pools;
  const disks = nas.disks;

  const usedTB = pools.reduce((sum, p) => sum + p.usedTB, 0);
  const totalTB = pools.reduce((sum, p) => sum + p.totalTB, 0);
  const fill = totalTB > 0 ? (usedTB / totalTB) * 100 : 0;
  const unhealthyPools = pools.filter((p) => poolStatus(p.status) !== 'ok').length;
  const smartIssues = disks.filter((d) => d.smart !== 'ok').length;

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <StatCard
        span={3}
        tone={fillSeverity(fill) === 'ok' ? 'default' : fillSeverity(fill)}
        icon={<Database strokeWidth={1.75} />}
        label="Capacity"
        value={totalTB > 0 ? `${fill.toFixed(0)}%` : '—'}
        hint={totalTB > 0 ? `${usedTB.toFixed(1)} / ${totalTB.toFixed(1)} TB used` : 'no pools'}
      />
      <StatCard
        span={3}
        tone={unhealthyPools > 0 ? 'bad' : 'default'}
        icon={<Database strokeWidth={1.75} />}
        label="Pools"
        value={pools.length}
        hint={unhealthyPools > 0 ? `${unhealthyPools} need attention` : 'all healthy'}
      />
      <StatCard
        span={3}
        tone={smartIssues > 0 ? 'warn' : 'default'}
        icon={<HardDrive strokeWidth={1.75} />}
        label="Disks"
        value={disks.length}
        hint={smartIssues > 0 ? `${smartIssues} SMART warnings` : 'SMART all ok'}
      />
      <StatCard
        span={3}
        icon={<Thermometer strokeWidth={1.75} />}
        label="NAS Temp"
        value={nas.tempC > 0 ? fmtTemp(nas.tempC, unit) : '—'}
        hint={nas.fanProfile && nas.fanProfile !== '—' ? `fan: ${nas.fanProfile}` : undefined}
      />

      <SectionCard span={6} title="Appliance" icon={<Database size={14} strokeWidth={1.75} />}>
        <div className="mb-3 text-xl font-semibold tracking-tight text-foreground">
          {nas.model && nas.model !== '—' ? nas.model : 'NAS'}
        </div>
        <StatList>
          <StatRow label="Name" value={nas.name} />
          <StatRow label="Temp" value={nas.tempC > 0 ? fmtTemp(nas.tempC, unit) : '—'} />
          <StatRow
            label="Fan profile"
            value={nas.fanProfile && nas.fanProfile !== '—' ? nas.fanProfile : 'unknown'}
          />
        </StatList>
      </SectionCard>

      <SectionCard
        span={6}
        title="Pool health"
        sub={pools.length}
        icon={<Fan size={14} strokeWidth={1.75} />}
        bodyClassName="flex flex-col gap-2"
      >
        {pools.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No storage pools reported
          </div>
        ) : (
          pools.map((p) => {
            const pFill = p.totalTB > 0 ? (p.usedTB / p.totalTB) * 100 : 0;
            return (
              <div
                key={p.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                  <StatusBadge kind={poolStatus(p.status)}>{p.status || 'unknown'}</StatusBadge>
                  <span className="truncate">{p.name}</span>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {p.usedTB.toFixed(1)} / {p.totalTB.toFixed(1)} TB · {pFill.toFixed(0)}%
                </span>
              </div>
            );
          })
        )}
      </SectionCard>
    </div>
  );
}

function Pools({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const nas = data.unas;
  const pools = nas.pools;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <div className="col-span-12 -mb-1 flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <Database className="size-3.5" />
        {nas.model && nas.model !== '—' ? nas.model : 'NAS'} · {pools.length} pool
        {pools.length === 1 ? '' : 's'}
        {nas.tempC > 0 ? ` · ${fmtTemp(nas.tempC, unit)}` : ''}
      </div>
      {pools.length === 0 ? (
        <SectionCard span={12} bodyClassName="py-8 text-center text-sm text-muted-foreground">
          No storage pools reported
        </SectionCard>
      ) : (
        pools.map((p: UnasPool) => {
          const fill = p.totalTB > 0 ? (p.usedTB / p.totalTB) * 100 : 0;
          const status = poolStatus(p.status);
          return (
            <EntityCard
              key={p.name}
              span={6}
              name={p.name}
              subtitle={p.type}
              icon={<Database />}
              status={status}
              statusLabel={p.status || 'unknown'}
              metrics={[
                {
                  key: 'fill',
                  label: 'Used',
                  pct: fill,
                  tone: fillSeverity(fill),
                  value: `${p.usedTB.toFixed(1)}/${p.totalTB.toFixed(1)} TB`,
                },
              ]}
              meta={[
                { key: 'scrub', value: p.scrub?.status ? `scrub: ${p.scrub.status}` : 'no scrub' },
                ...(p.incompatibilities.length
                  ? [{ key: 'incompat', value: `${p.incompatibilities.length} warnings` }]
                  : []),
              ]}
            />
          );
        })
      )}
    </div>
  );
}

function Disks({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const disks = data.storage.disks;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SmartTile data={data.storage} span={12} />
      <DataTableCard
        span={12}
        title="All Disks"
        sub={disks.length}
        icon={<HardDrive size={14} strokeWidth={1.75} />}
        isEmpty={disks.length === 0}
        empty="No disks reported"
        head={
          <>
            <TableHead>SMART</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Temp</TableHead>
            <TableHead className="text-right" title="Total power-on time (drive age)">
              Age
            </TableHead>
          </>
        }
      >
        {disks.map((d) => {
          const kind = d.smart === 'warn' ? 'warn' : d.smart === 'bad' ? 'bad' : 'ok';
          return (
            <TableRow key={d.name}>
              <TableCell>
                <StatusBadge kind={kind} dot={false}>
                  <ShieldCheck strokeWidth={2} />
                  {d.smart}
                </StatusBadge>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5 font-mono text-foreground">
                  <HardDrive size={13} strokeWidth={1.75} className="text-muted-foreground" />
                  {d.name}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{d.model}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtTemp(d.tempC, unit)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPowerOnTime(d.ageHours)}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTableCard>
    </div>
  );
}

export function NasPage({ data, sub, onSelectSub }: Props) {
  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <SubTabs tabs={NAS_TABS} active={sub} onChange={onSelectSub} />
      {sub === 'disks' ? (
        <Disks data={data} />
      ) : sub === 'pools' ? (
        <Pools data={data} />
      ) : (
        <Overview data={data} />
      )}
    </div>
  );
}
