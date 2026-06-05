import { Tile } from '../tile/Tile';
import type { Fan } from '../../types';
import { fanSeverity } from '../../lib/severity';
import { CapabilityTitle } from '@/lib/presentation';

interface Props {
  data: Fan[];
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

/** Fan duty-cycle pct, guarded against missing/zero max so a sensor that
 *  reports {rpm: 800, max: 0} doesn't pin the tile to Infinity (which
 *  fanSeverity then classifies as 'bad'). */
function fanPct(f: { rpm: number; max: number }): number {
  if (!Number.isFinite(f.rpm) || !Number.isFinite(f.max) || f.max <= 0) return 0;
  return (f.rpm / f.max) * 100;
}

export function FansTile({ data, span, onExpand, expandable }: Props) {
  const count = data.length;
  const avgRpm = count ? Math.round(data.reduce((a, f) => a + f.rpm, 0) / count) : 0;
  const maxRpm = count ? Math.max(...data.map((f) => f.rpm)) : 0;
  // Only fans with a real `max` contribute to severity; otherwise we'd
  // either ignore everyone (when every fan has max=0) or fake a band.
  const ratedPcts = data.map(fanPct).filter((p) => p > 0);
  const worstPct = ratedPcts.length ? Math.max(...ratedPcts) : 0;
  const allUnknown = count > 0 && ratedPcts.length === 0;
  const kind = allUnknown ? 'info' : fanSeverity(worstPct);
  const tagLabel = allUnknown
    ? 'unknown'
    : kind === 'ok'
      ? 'nominal'
      : kind === 'warn'
        ? 'high'
        : 'critical';
  return (
    <Tile
      title={<CapabilityTitle capability="sensors" suffix="Fans" />}
      sub={`${count} sensors`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: tagLabel, kind }}
    >
      <div className="t-big">
        {avgRpm}
        <small> rpm avg</small>
      </div>
      <div className="t-sub">max {maxRpm} rpm</div>
    </Tile>
  );
}
