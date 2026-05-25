import { Tile } from '../tile/Tile';
import { AutoChart, Donut } from '../charts';
import type { ChartKind, CPUData } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';
import { cpuTempSeverity, cpuUsageSeverity } from '../../lib/severity';

interface Props {
  data: CPUData;
  span?: number;
  onExpand?: () => void;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  expandable?: boolean;
}

export function CPUTile({ data, span, onExpand, chartKind, onChartKind, expandable }: Props) {
  const { usage, tempC, history, cores, threads, model } = data;
  const { unit } = useTempUnit();
  const tempKind = cpuTempSeverity(tempC);
  const usageKind = cpuUsageSeverity(usage);
  return (
    <Tile
      title="CPU"
      sub={`${cores}c / ${threads}t`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: fmtTemp(tempC, unit), kind: tempKind }}
      chartKind={chartKind}
      onChartKind={onChartKind}
    >
      <div className="metric-row">
        <Donut value={usage} label={`${usage.toFixed(0)}%`} sub="usage" kind={usageKind} />
        <div className="meta flex1">
          <div className="lbl">{model}</div>
          <AutoChart kind={chartKind ?? 'area'} data={history} height={48} severity={usageKind} />
        </div>
      </div>
    </Tile>
  );
}
