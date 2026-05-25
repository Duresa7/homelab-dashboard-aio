import { Tile } from '../tile/Tile';
import type { Severity, StorageData } from '../../types';
import { fillSeverity } from '../../lib/severity';

interface Props {
  data: StorageData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { ok: 0, info: 1, warn: 2, bad: 3 };

export function StorageTile({ data, span, onExpand, expandable }: Props) {
  const totalTB = data.pools.reduce((a, p) => a + p.totalTB, 0);
  const usedTB = data.pools.reduce((a, p) => a + p.usedTB, 0);
  const summedPct = totalTB ? (usedTB / totalTB) * 100 : 0;

  // Compute the WORST per-pool severity rather than the severity of the
  // sum — otherwise a 100%-full small pool gets averaged into a fleet-wide
  // fill that looks fine, and the overview shows green while the user is
  // already out of space on one disk.
  let worstKind: Severity = 'ok';
  let worstPct = 0;
  for (const p of data.pools) {
    const poolPct = p.totalTB > 0 ? (p.usedTB / p.totalTB) * 100 : 0;
    const poolKind: Severity = p.status === 'degraded' ? 'bad' : fillSeverity(poolPct);
    if (SEVERITY_RANK[poolKind] > SEVERITY_RANK[worstKind]) worstKind = poolKind;
    if (poolPct > worstPct) worstPct = poolPct;
  }
  const tagPct = worstKind === 'ok' ? summedPct : worstPct;
  return (
    <Tile
      title="NAS Pools"
      sub={`${data.pools.length} pools`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${tagPct.toFixed(0)}%`, kind: worstKind }}
    >
      <div className="t-big">
        {usedTB.toFixed(1)}
        <small> / {totalTB.toFixed(1)} TB</small>
      </div>
      <div className="pbar">
        <span className={worstKind === 'ok' ? '' : worstKind} style={{ width: `${summedPct}%` }} />
      </div>
    </Tile>
  );
}
