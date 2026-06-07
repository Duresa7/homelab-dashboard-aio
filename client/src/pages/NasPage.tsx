import { Database, HardDrive, ShieldCheck } from 'lucide-react';
import { SmartTile } from '../components/widgets';
import { DataTableCard, EntityCard, SectionCard, StatusBadge, SubTabs } from '@/components/common';
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
  { id: 'pools', label: 'Pools' },
  { id: 'disks', label: 'Disks' },
];

function poolStatus(status: string): 'ok' | 'warn' | 'bad' {
  if (/degraded|offline|error|fault/i.test(status)) return 'bad';
  if (/resilver|scrub|rebuild|warn/i.test(status)) return 'warn';
  return 'ok';
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
      <SmartTile data={data.storage} span={12} expandable={false} />
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
      {sub === 'disks' ? <Disks data={data} /> : <Pools data={data} />}
    </div>
  );
}
