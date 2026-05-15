import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import type { ChartKind, Severity } from '../../types';

interface TileTag {
  label: string;
  kind?: Severity;
}

export interface TileProps {
  title: ReactNode;
  sub?: ReactNode;
  span?: number;
  tag?: TileTag;
  action?: ReactNode;
  children?: ReactNode;
  chartKind?: ChartKind;
  onChartKind?: (k: ChartKind) => void;
  onExpand?: () => void;
  expandable?: boolean;
  id?: string;
}

const CHART_KINDS: ChartKind[] = ['area', 'sparkline', 'bars'];

export function Tile({
  title,
  sub,
  span = 4,
  tag,
  action,
  children,
  chartKind,
  onChartKind,
  onExpand,
  expandable = true,
  id,
}: TileProps) {
  return (
    <div className={`tile span-${span}`} data-tile={id}>
      <div className="t-head">
        <div className="t-title">
          {title}
          {tag ? <span className={`t-tag ${tag.kind ?? ''}`}>{tag.label}</span> : null}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {sub ? <div className="t-sub">{sub}</div> : null}
          {onChartKind ? (
            <div className="chart-pick">
              {CHART_KINDS.map((k) => (
                <button
                  key={k}
                  className={chartKind === k ? 'is-on' : ''}
                  onClick={() => onChartKind(k)}
                  title={k}
                >
                  <Icon
                    name={k === 'area' ? 'chart_area' : k === 'bars' ? 'chart_bar' : 'chart_line'}
                    size={11}
                  />
                </button>
              ))}
            </div>
          ) : null}
          {action ?? null}
          {expandable && onExpand ? (
            <button
              className="icon-btn"
              onClick={onExpand}
              title="Expand"
              style={{ width: 26, height: 26 }}
            >
              <Icon name="expand" size={11} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="col" style={{ flex: 1 }}>
        {children}
      </div>
    </div>
  );
}
