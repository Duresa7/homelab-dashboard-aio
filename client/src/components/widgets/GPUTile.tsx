import { Tile } from '../tile/Tile';
import { AutoChart, Donut, TrendArrow } from '../charts';
import { BrandIcon } from '../icons/BrandIcon';
import type { ChartKind, GPUData } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';
import { gpuTempSeverity, gpuUsageSeverity, fanSeverity, severityColor } from '../../lib/severity';

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
  const tempKind = gpuTempSeverity(tempC);
  const usageKind = gpuUsageSeverity(usage);
  const fanKind = fanSeverity(fanPct);
  return (
    <Tile
      title={<><BrandIcon name="nvidia" alt="NVIDIA" /> GPU</>}
      sub={model}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: fmtTemp(tempC, unit), kind: tempKind }}
      chartKind={chartKind}
      onChartKind={onChartKind}
    >
      <div className="metric-row">
        <Donut value={usage} label={`${usage.toFixed(0)}%`} sub="gpu" kind={usageKind} />
        <div className="meta flex1">
          <div className="v">
            {memUsedGB.toFixed(1)} / {memTotalGB} GB VRAM
            <TrendArrow data={history} goodDirection="down" />
          </div>
          <div className="lbl">
            {powerW.toFixed(0)} / {powerMaxW} W · fan {fanPct.toFixed(0)}%
          </div>
          <AutoChart kind={chartKind ?? 'area'} data={history} height={40} severity={usageKind} />
        </div>
      </div>
      <dl className="kv">
        <dt>Power</dt><dd>{powerW.toFixed(0)} W</dd>
        <dt>Fan</dt><dd style={{ color: severityColor[fanKind] }}>{fanPct.toFixed(0)}%</dd>
        <dt>Temp</dt><dd style={{ color: severityColor[tempKind] }}>{fmtTemp(tempC, unit)}</dd>
      </dl>
    </Tile>
  );
}
