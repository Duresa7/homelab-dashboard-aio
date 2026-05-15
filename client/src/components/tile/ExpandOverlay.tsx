import { AreaChart } from '../charts';
import { Icon } from '../icons/Icon';
import { ALL_TILES, renderTile, tileData, type TileId } from '../widgets/registry';
import { CPUTile } from '../widgets/CPUTile';
import { TempHeatTile } from '../widgets/TempHeatTile';
import type { ChartKind, DashboardState } from '../../types';

interface Props {
  id: TileId | null;
  data: DashboardState;
  chartKind: ChartKind;
  setChartKind: (k: ChartKind) => void;
  onClose: () => void;
}

export function ExpandOverlay({ id, data, chartKind, setChartKind, onClose }: Props) {
  if (!id) return null;
  const def = ALL_TILES.find((t) => t.id === id);
  const td = tileData(id, data);

  let content: React.ReactNode;
  if (id === 'tempHeat') {
    const { cpu, gpu, disks } = td as { cpu: any; gpu: any; disks: any };
    content = <TempHeatTile cpu={cpu} gpu={gpu} disks={disks} span={12} expandable={false} />;
  } else if (id === 'cpu') {
    content = (
      <div className="grid">
        <CPUTile data={data.cpu} span={12} chartKind={chartKind} onChartKind={setChartKind} expandable={false} />
        <div className="tile span-12">
          <div className="t-title">All cores · live</div>
          <div className="cores" style={{ gridTemplateColumns: 'repeat(16, 1fr)' }}>
            {data.cpu.coreList.map((c) => {
              const cls = c.pct > 85 ? 'bad' : c.pct > 65 ? 'warn' : '';
              return (
                <div
                  key={c.id}
                  className={`core ${cls}`}
                  style={{ ['--p' as any]: `${c.pct.toFixed(0)}%`, height: 36 }}
                >
                  <span>{c.pct.toFixed(0)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="tile span-6">
          <div className="t-title">Usage history</div>
          <AreaChart data={data.cpu.history} height={140} />
        </div>
        <div className="tile span-6">
          <div className="t-title">Temperature history</div>
          <AreaChart data={data.cpu.tempHistory} height={140} color="var(--warn)" />
        </div>
      </div>
    );
  } else {
    content = renderTile({
      id,
      span: 12,
      data: td,
      chartKind,
      onChartKind: setChartKind,
      expandable: false,
    });
  }

  return (
    <div className="expanded-overlay" onClick={onClose}>
      <div className="expanded-panel" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ marginBottom: 18 }}>
          <div>
            <h2>{def ? def.label : id}</h2>
            <div className="sub">expanded view · click outside or press Esc to close</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {content}
      </div>
    </div>
  );
}
