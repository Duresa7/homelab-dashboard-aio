import { Tile } from '../tile/Tile';
import { AutoChart, Donut } from '../charts';
import type { ChartKind, GPUData } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';
import { gpuTempSeverity, gpuUsageSeverity } from '../../lib/severity';
import { CapabilityTitle } from '@/lib/presentation';

interface Props {
  data: GPUData;
  span?: number;
  onExpand?: () => void;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  expandable?: boolean;
}

export function GPUTile({ data, span, onExpand, chartKind, onChartKind, expandable }: Props) {
  const { usage, tempC, memUsedGB, memTotalGB, history, model } = data;
  const { unit } = useTempUnit();
  const tempKind = gpuTempSeverity(tempC);
  const usageKind = gpuUsageSeverity(usage);
  return (
    <Tile
      title={<CapabilityTitle capability="gpu" />}
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
            <b>{memUsedGB.toFixed(1)}</b>
            <span className="text-muted"> / {memTotalGB} GB VRAM</span>
          </div>
          <AutoChart kind={chartKind ?? 'area'} data={history} height={40} severity={usageKind} />
        </div>
      </div>
    </Tile>
  );
}
