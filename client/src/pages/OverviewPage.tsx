import { cloneElement, type ReactElement } from 'react';
import { ALL_TILES, renderTile, tileData, type TileId } from '../components/widgets';
import type { ChartKind, DashboardState } from '../types';

interface Props {
  data: DashboardState;
  layout: TileId[];
  chartKinds: Partial<Record<TileId, ChartKind>>;
  setChartKind: (id: TileId, k: ChartKind) => void;
  onExpand: (id: TileId) => void;
}

export function OverviewPage({ data, layout, chartKinds, setChartKind, onExpand }: Props) {
  return (
    <div className="grid">
      {layout.map((id) => {
        const def = ALL_TILES.find((t) => t.id === id);
        if (!def) return null;
        const el = renderTile({
          id,
          span: def.span,
          data: tileData(id, data),
          chartKind: chartKinds[id],
          onChartKind: (k) => setChartKind(id, k),
          onExpand: () => onExpand(id),
          expandable: true,
        }) as ReactElement;
        return el ? cloneElement(el, { key: id }) : null;
      })}
    </div>
  );
}
