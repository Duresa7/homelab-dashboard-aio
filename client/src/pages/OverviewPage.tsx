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

interface SectionDef {
  id: string;
  label: string | null;
  tiles: TileId[];
  bare?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: 'apps', label: null, tiles: ['bookmarks'], bare: true },
  { id: 'system', label: 'System', tiles: ['cpu', 'ram', 'gpu', 'ups', 'fans', 'tempHeat'] },
  { id: 'storage', label: 'Storage', tiles: ['storage', 'smart', 'unas', 'backups'] },
  { id: 'network', label: 'Network', tiles: ['internet', 'unifi', 'network', 'topTalkers'] },
  { id: 'services', label: 'Services', tiles: ['docker', 'proxmox', 'protect'] },
  { id: 'activity', label: 'Activity', tiles: ['events'] },
];

export function OverviewPage({ data, layout, chartKinds, setChartKind, onExpand }: Props) {
  const visible = new Set(layout);

  const renderOne = (id: TileId) => {
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
      compact: true,
    }) as ReactElement | null;
    return el ? cloneElement(el, { key: id }) : null;
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {SECTIONS.map((section) => {
        const tiles = section.tiles.filter((id) => visible.has(id));
        if (tiles.length === 0) return null;
        const ordered = layout.filter((id) => section.tiles.includes(id));
        return (
          <section key={section.id} className="flex flex-col gap-3">
            {section.label && (
              <h2 className="flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {section.label}
                <span className="font-mono text-[11px] tabular-nums text-[var(--ink-4)]">
                  {ordered.length}
                </span>
              </h2>
            )}
            <div className="grid grid-cols-12 gap-[var(--gap)]">{ordered.map(renderOne)}</div>
          </section>
        );
      })}
    </div>
  );
}
