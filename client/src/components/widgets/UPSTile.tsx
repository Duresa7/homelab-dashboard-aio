import { Tile } from '../tile/Tile';
import type { UPSData } from '../../types';
import { batterySeverity } from '../../lib/severity';

interface Props {
  data: UPSData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function UPSTile({ data, span, onExpand, expandable }: Props) {
  const batteryKind = batterySeverity(data.batteryPct);
  return (
    <Tile
      title="UPS"
      sub={data.model}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${data.batteryPct}% · ${data.status}`, kind: batteryKind }}
    >
      <div className="t-big">
        {data.runtimeMin}
        <small> min runtime</small>
      </div>
      <div className="t-sub">
        load {data.loadW} W · {data.loadPct}%
      </div>
    </Tile>
  );
}
