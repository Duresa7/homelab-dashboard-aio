import { Tile } from '../tile/Tile';
import { Heatmap } from '../charts';
import type { CPUData, Disk, GPUData } from '../../types';

interface Props {
  cpu: CPUData;
  gpu: GPUData;
  disks: Disk[];
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function TempHeatTile({ cpu, disks, span, onExpand, expandable }: Props) {
  const cols = 24;
  const series = [
    { name: 'CPU', data: cpu.tempHistory.slice(-cols) },
    { name: 'GPU', data: cpu.tempHistory.slice(-cols).map((v, i) => v - 8 + (i % 3)) },
    {
      name: 'NVMe',
      data: disks.slice(0, 1).flatMap(() =>
        Array.from({ length: cols }, (_, i) => 38 + (i % 5) + Math.sin(i / 3) * 4),
      ),
    },
    {
      name: 'HDD',
      data: disks.slice(0, 1).flatMap(() => Array.from({ length: cols }, (_, i) => 36 + Math.cos(i / 4) * 3)),
    },
    { name: 'NAS', data: Array.from({ length: cols }, (_, i) => 34 + Math.sin(i / 5) * 2) },
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
        {series.map((s) => (
          <div
            key={s.name}
            style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 8, alignItems: 'center' }}
          >
            <div className="t-sub mono" style={{ fontSize: 10 }}>{s.name}</div>
            <Heatmap rows={1} cols={cols} data={s.data} max={85} />
          </div>
        ))}
      </div>
      <div className="legend">
        <div className="item">
          <div className="swatch" style={{ background: 'var(--bg-3)' }} /> 30°C
        </div>
        <div className="item">
          <div
            className="swatch"
            style={{ background: 'color-mix(in oklab, var(--accent) 50%, var(--bg-3))' }}
          />{' '}
          60°C
        </div>
        <div className="item">
          <div className="swatch" style={{ background: 'var(--accent)' }} /> 80°C+
        </div>
      </div>
    </Tile>
  );
}
