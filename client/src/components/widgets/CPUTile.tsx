import type { CSSProperties } from 'react';
import { Tile } from '../tile/Tile';
import { AutoChart, Donut, TrendArrow } from '../charts';
import type { ChartKind, CPUData } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';
import { cpuTempSeverity, cpuUsageSeverity, severityColor } from '../../lib/severity';

interface Props {
  data: CPUData;
  span?: number;
  onExpand?: () => void;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  expandable?: boolean;
}

export function CPUTile({ data, span, onExpand, chartKind, onChartKind, expandable }: Props) {
  const { usage, tempC, history, tempHistory, coreList, cores, threads, model } = data;
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
          <div className="v">
            <span style={{ color: severityColor[usageKind] }}>{usage.toFixed(1)}%</span>
            <TrendArrow data={history} goodDirection="down" /> ·{' '}
            <span style={{ color: severityColor[tempKind] }}>{fmtTemp(tempC, unit)}</span>
            <TrendArrow data={tempHistory} goodDirection="down" /> ·{' '}
            {((usage / 100) * cores).toFixed(1)} cores busy
          </div>
          <AutoChart kind={chartKind ?? 'area'} data={history} height={40} severity={usageKind} />
        </div>
      </div>
      <div className="cores" style={{ gridTemplateColumns: `repeat(${Math.min(cores, 8)}, 1fr)` }}>
        {coreList.slice(0, cores).map((c) => {
          const cls = c.pct > 85 ? 'bad' : c.pct > 65 ? 'warn' : '';
          return (
            <div
              key={c.id}
              className={`core ${cls}`}
              style={{ '--p': `${c.pct.toFixed(0)}%` } as CSSProperties}
            >
              <span>{c.pct.toFixed(0)}</span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}
