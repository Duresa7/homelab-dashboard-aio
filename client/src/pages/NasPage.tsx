import { HardDrive, ShieldCheck } from 'lucide-react';
import { SmartTile, StorageTile, UnasTile } from '../components/widgets';
import { DataTableCard, StatusBadge } from '@/components/common';
import { TableCell, TableHead } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import type { DashboardState } from '../types';
import { fmtTemp, useTempUnit } from '../lib/units';
import { formatPowerOnTime } from '../lib/format';

interface Props {
  data: DashboardState;
  sub: string;
}

function Pools({ data }: { data: DashboardState }) {
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <StorageTile data={data.storage} span={6} expandable={false} />
      <UnasTile data={data.unas} span={6} expandable={false} />
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
              <TableCell className="text-right tabular-nums">{formatPowerOnTime(d.ageHours)}</TableCell>
            </TableRow>
          );
        })}
      </DataTableCard>
    </div>
  );
}

export function NasPage({ data, sub }: Props) {
  if (sub === 'disks') return <Disks data={data} />;
  return <Pools data={data} />;
}
