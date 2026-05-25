import { Tile } from '../tile/Tile';
import { BrandIcon } from '../icons/BrandIcon';
import type { ChartKind, NetworkData } from '../../types';

interface Props {
  data: NetworkData;
  span?: number;
  onExpand?: () => void;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  expandable?: boolean;
}

export function NetworkTile({ data, span, onExpand, chartKind, onChartKind, expandable }: Props) {
  const { downHistory, upHistory, latencyMs } = data;
  const dn = downHistory[downHistory.length - 1];
  const up = upHistory[upHistory.length - 1];
  return (
    <Tile
      title={<><BrandIcon name="unifi" alt="UniFi" /> Network</>}
      sub={`${latencyMs.toFixed(1)} ms`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      chartKind={chartKind}
      onChartKind={onChartKind}
    >
      <div className="netrate">
        <div className="col">
          <div className="label">↓ download</div>
          <div className="v">{dn.toFixed(0)}<small>Mbps</small></div>
        </div>
        <div className="col">
          <div className="label">↑ upload</div>
          <div className="v">{up.toFixed(0)}<small>Mbps</small></div>
        </div>
      </div>
    </Tile>
  );
}
