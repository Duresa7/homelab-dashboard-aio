import { Tile } from '../tile/Tile';
import { AutoChart } from '../charts';
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
  const { downHistory, upHistory, latencyMs, speedtest, uptime30d } = data;
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
          <AutoChart kind={chartKind ?? 'area'} data={downHistory} height={36} />
        </div>
        <div className="col">
          <div className="label">↑ upload</div>
          <div className="v" style={{ color: 'var(--ink)' }}>
            {up.toFixed(0)}<small>Mbps</small>
          </div>
          <AutoChart kind={chartKind ?? 'area'} data={upHistory} height={36} />
        </div>
      </div>
      <dl className="kv" style={{ borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
        <dt>Last speedtest</dt>
        <dd>{speedtest.down}/{speedtest.up} Mbps</dd>
        <dt>Uptime 30d</dt>
        <dd>{uptime30d.toFixed(2)}%</dd>
      </dl>
    </Tile>
  );
}
