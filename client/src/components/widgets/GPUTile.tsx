import { Tile } from '../tile/Tile';
import { AutoChart, Donut } from '../charts';
import type { ChartKind, GPUData } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';

interface Props {
  data: GPUData;
  span?: number;
  onExpand?: () => void;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  expandable?: boolean;
}

export function GPUTile({ data, span, onExpand, chartKind, onChartKind, expandable }: Props) {
  const { usage, tempC, fanPct, powerW, powerMaxW, memUsedGB, memTotalGB, history, model } = data;
  const { unit } = useTempUnit();
  return (
    <Tile
      title="GPU"
      sub={model}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: fmtTemp(tempC, unit), kind: tempC > 75 ? 'bad' : tempC > 68 ? 'warn' : 'ok' }}
      chartKind={chartKind}
      onChartKind={onChartKind}
    >
      <div className="metric-row">
        <Donut value={usage} label={`${usage.toFixed(0)}%`} sub="gpu" />
        <div className="meta flex1">
          <div className="v">
            {memUsedGB.toFixed(1)} / {memTotalGB} GB VRAM
          </div>
          <div className="lbl">
            {powerW.toFixed(0)} / {powerMaxW} W · fan {fanPct.toFixed(0)}%
          </div>
          <AutoChart kind={chartKind ?? 'area'} data={history} height={40} />
        </div>
      </div>
      <dl className="kv">
        <dt>Power</dt><dd>{powerW.toFixed(0)} W</dd>
        <dt>Fan</dt><dd>{fanPct.toFixed(0)}%</dd>
        <dt>Temp</dt><dd>{fmtTemp(tempC, unit)}</dd>
      </dl>
    </Tile>
  );
}
