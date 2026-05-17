import { Tile } from '../tile/Tile';
import { Heatmap } from '../charts';
import type { CPUData, GPUData } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';

interface TempSensor {
  name: string;
  model?: string;
  tempC: number;
}

interface Props {
  cpu: CPUData;
  gpu: GPUData;
  disks: TempSensor[];
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function TempHeatTile({ cpu, gpu, disks, span, onExpand, expandable }: Props) {
  const { unit } = useTempUnit();
  const cols = 24;
  const diskSeries = disks.slice(0, 3).map((d, idx) => {
    const base = Number.isFinite(d.tempC) ? d.tempC : 0;
    return {
      name: d.model || d.name,
      data: Array.from({ length: cols }, (_, i) => base + Math.sin((i + idx) / 3) * 1.5),
    };
  });
  const series = [
    { name: 'CPU', data: cpu.tempHistory.slice(-cols) },
    {
      name: 'GPU',
      data: Array.from({ length: cols }, (_, i) => (gpu.tempC || 0) + Math.sin(i / 4) * 1.5),
    },
    ...diskSeries,
  ];
  return (
    <Tile
      title="Temperature Heatmap"
      sub="all sensors · 24 ticks"
      span={span}
      onExpand={onExpand}
      expandable={expandable}
    >
      <div className="col" style={{ gap: 4 }}>
        {series.map((s, i) => (
          <div
            key={`${s.name}-${i}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(72px, 120px) 1fr',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <div
              className="t-sub"
              style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={s.name}
            >
              {s.name}
            </div>
            <Heatmap cols={cols} data={s.data} max={85} />
          </div>
        ))}
      </div>
      <div className="legend">
        <div className="item">
          <div className="swatch" style={{ background: 'var(--bg-3)' }} /> {fmtTemp(30, unit)}
        </div>
        <div className="item">
          <div
            className="swatch"
            style={{ background: 'color-mix(in oklab, var(--accent) 50%, var(--bg-3))' }}
          />{' '}
          {fmtTemp(60, unit)}
        </div>
        <div className="item">
          <div className="swatch" style={{ background: 'var(--accent)' }} /> {fmtTemp(80, unit)}+
        </div>
      </div>
    </Tile>
  );
}
