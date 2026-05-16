import { Tile } from '../tile/Tile';
import { AutoChart, Donut } from '../charts';
import type { ChartKind, RAMData, Severity } from '../../types';

interface Props {
  data: RAMData;
  span?: number;
  onExpand?: () => void;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  expandable?: boolean;
}

export function RAMTile({ data, span, onExpand, chartKind, onChartKind, expandable }: Props) {
  const { totalGB, usedGB, history, cachedGB } = data;
  const pct = (usedGB / totalGB) * 100;
  const kind: Severity = pct > 90 ? 'bad' : pct > 75 ? 'warn' : 'ok';
  return (
    <Tile
      title="Memory"
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${pct.toFixed(0)}%`, kind }}
      chartKind={chartKind}
      onChartKind={onChartKind}
    >
      <div className="metric-row">
        <Donut value={pct} label={`${pct.toFixed(0)}%`} sub="ram" />
        <div className="meta flex1">
          <div className="v">
            <b style={{ color: 'var(--ink)' }}>{usedGB.toFixed(1)} GB</b> / {totalGB} GB
          </div>
          <div className="lbl">
            {cachedGB.toFixed(1)} GB cached · {(totalGB - usedGB).toFixed(1)} GB free
          </div>
          <AutoChart kind={chartKind ?? 'area'} data={history} height={40} />
        </div>
      </div>
    </Tile>
  );
}
