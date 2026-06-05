import { Tile } from '../tile/Tile';
import type { Severity, UnasData } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';
import { CapabilityTitle } from '@/lib/presentation';

interface Props {
  data: UnasData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
  compact?: boolean;
}

function tempKind(tempC: number): Severity {
  if (tempC >= 55) return 'bad';
  if (tempC >= 50) return 'warn';
  return 'ok';
}

export function UnasTile({ data, span, onExpand, expandable }: Props) {
  const { unit } = useTempUnit();
  const { model, tempC, pools, disks } = data;
  const totalTB = pools.reduce((a, p) => a + p.totalTB, 0);
  const usedTB = pools.reduce((a, p) => a + p.usedTB, 0);
  const anyDegraded = pools.some((p) => p.status === 'degraded' || p.status === 'offline');

  return (
    <Tile
      title={<CapabilityTitle capability="nas" suffix={model} />}
      sub={`${disks.length} drives`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: fmtTemp(tempC, unit), kind: tempKind(tempC) }}
    >
      <div className="t-big">
        {usedTB.toFixed(1)}
        <small> / {totalTB.toFixed(1)} TB</small>
      </div>
      <div className="t-sub">
        {pools.length} pool{pools.length === 1 ? '' : 's'}
        {anyDegraded ? <span className="text-warn"> · degraded</span> : null}
      </div>
    </Tile>
  );
}
