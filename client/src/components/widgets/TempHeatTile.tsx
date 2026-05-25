import { Tile } from '../tile/Tile';
import { Heatmap } from '../charts';
import type { CPUData, GPUData } from '../../types';

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
      title="Temperature"
      sub={`${series.length} sensors`}
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
              gridTemplateColumns: 'minmax(0, 120px) minmax(0, 1fr)',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <div
              className="t-sub"
              style={{ fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={s.name}
            >
              {s.name}
            </div>
            <Heatmap cols={cols} data={s.data} max={85} />
          </div>
        ))}
      </div>
    </Tile>
  );
}
