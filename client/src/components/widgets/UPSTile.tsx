import { Tile } from '../tile/Tile';
import { BigNum, Donut } from '../charts';
import type { UPSData } from '../../types';

interface Props {
  data: UPSData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function UPSTile({ data, span, onExpand, expandable }: Props) {
  return (
    <Tile
      title="UPS"
      sub={data.model}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: data.status, kind: 'ok' }}
    >
      <div className="row" style={{ gap: 14 }}>
        <Donut value={data.batteryPct} label={`${data.batteryPct}%`} sub="battery" size={84} />
        <div className="col flex1">
          <BigNum
            value={data.loadW}
            unit="W"
            sub={`${data.loadPct}% load · runtime ${data.runtimeMin} min`}
          />
          <div className="pbar">
            <span style={{ width: `${data.loadPct}%` }} />
          </div>
        </div>
      </div>
    </Tile>
  );
}
