import type { ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { cn } from '@/lib/utils';
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

/** Responsive column spans against the 12-column overview grid. */
const SPAN_CLASS: Record<number, string> = {
  3: 'col-span-12 sm:col-span-6 lg:col-span-3',
  4: 'col-span-12 sm:col-span-6 lg:col-span-4',
  6: 'col-span-12 lg:col-span-6',
  12: 'col-span-12',
};

const TAG_CLASS: Record<string, string> = {
  ok: 'border-[color-mix(in_oklab,var(--ok)_28%,transparent)] bg-[color-mix(in_oklab,var(--ok)_12%,transparent)] text-[var(--ok)]',
  warn: 'border-[color-mix(in_oklab,var(--warn)_28%,transparent)] bg-[color-mix(in_oklab,var(--warn)_12%,transparent)] text-[var(--warn)]',
  bad: 'border-[color-mix(in_oklab,var(--bad)_28%,transparent)] bg-[color-mix(in_oklab,var(--bad)_12%,transparent)] text-[var(--bad)]',
  info: 'border-[color-mix(in_oklab,var(--info)_28%,transparent)] bg-[color-mix(in_oklab,var(--info)_12%,transparent)] text-[var(--info)]',
};

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
    <div
      className={cn(
        'group/tile relative flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-[var(--pad)] shadow-card transition-shadow duration-200 hover:shadow-card-hover',
        SPAN_CLASS[span] ?? 'col-span-12 sm:col-span-6 lg:col-span-4',
      )}
      data-tile={id}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12.5px] font-semibold tracking-wide text-muted-foreground">
            {title}
          </span>
          {tag ? (
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-px text-[10px] font-medium lowercase tabular-nums',
                TAG_CLASS[tag.kind ?? ''] ?? 'border-border text-muted-foreground',
              )}
            >
              {tag.label}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {sub ? <div className="text-xs tabular-nums text-muted-foreground">{sub}</div> : null}
          {onChartKind ? (
            <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
              {CHART_KINDS.map((k) => (
                <button
                  key={k}
                  className={cn(
                    'grid size-5 place-items-center rounded transition-colors',
                    chartKind === k
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => onChartKind(k)}
                  title={k}
                  aria-label={`Chart: ${k}`}
                >
                  <Icon name={k === 'area' ? 'chart_area' : k === 'bars' ? 'chart_bar' : 'chart_line'} size={11} />
                </button>
              ))}
            </div>
          ) : null}
          {action ?? null}
          {expandable && onExpand ? (
            <button
              className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/tile:opacity-100"
              onClick={onExpand}
              title="Expand"
              aria-label="Expand"
            >
              <Maximize2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}
