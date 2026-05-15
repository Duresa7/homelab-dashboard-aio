import { Tile } from '../tile/Tile';
import { AutoChart, Donut } from '../charts';
import type { ChartKind, CPUData } from '../../types';

interface Props {
  data: CPUData;
  span?: number;
  onExpand?: () => void;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  expandable?: boolean;
}

export function CPUTile({ data, span, onExpand, chartKind, onChartKind, expandable }: Props) {
  const { usage, tempC, history, coreList, cores, threads, model } = data;
  const tempCls = tempC > 75 ? 'bad' : tempC > 65 ? 'warn' : '';
  return (
    <Tile
      title="CPU"
      sub={`${cores}c / ${threads}t`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${tempC.toFixed(0)}°C`, kind: (tempCls || 'ok') as any }}
      chartKind={chartKind}
      onChartKind={onChartKind}
    >
      <div className="metric-row">
        <Donut value={usage} label={`${usage.toFixed(0)}%`} sub="usage" />
        <div className="meta flex1">
          <div className="lbl mono">{model}</div>
          <div className="v">
            {usage.toFixed(1)}% · {tempC.toFixed(0)}°C ·{' '}
            {((usage / 100) * cores).toFixed(1)} cores busy
          </div>
          <AutoChart kind={chartKind ?? 'area'} data={history} height={40} />
        </div>
      </div>
      <div className="cores" style={{ gridTemplateColumns: `repeat(${Math.min(cores, 8)}, 1fr)` }}>
        {coreList.slice(0, cores).map((c) => {
          const cls = c.pct > 85 ? 'bad' : c.pct > 65 ? 'warn' : '';
          return (
            <div
              key={c.id}
              className={`core ${cls}`}
              style={{ ['--p' as any]: `${c.pct.toFixed(0)}%` }}
            >
              <span>{c.pct.toFixed(0)}</span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}
