import { useState } from 'react';
import { polylinePath } from './path';
import type { Severity } from '../../types';
import { severityColor } from '../../lib/severity';

interface Props {
  data: number[];
  height?: number;
  color?: string;
  kind?: Severity;

  formatValue?: (v: number) => string;

  showBounds?: boolean;
}

const PAD = 2;
const W = 200;

interface HoverState {
  i: number;

  x: number;
  y: number;
}

export function AreaChart({ data, height = 56, color, kind, formatValue, showBounds }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const h = height;
  const path = polylinePath(data, W, h, PAD);
  const fill = path ? `${path} L${W - PAD},${h - PAD} L${PAD},${h - PAD} Z` : '';
  const stroke = kind ? severityColor[kind] : (color ?? 'var(--accent)');

  const min = data.length ? Math.min(...data) : 0;
  const max = data.length ? Math.max(...data) : 0;
  const range = Math.max(1e-6, max - min);
  const fmt = formatValue ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)));

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (data.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const plotFrac = Math.min(1, Math.max(0, (frac * W - PAD) / (W - PAD * 2)));
    const i = Math.round(plotFrac * (data.length - 1));
    const x = (PAD + (i / (data.length - 1)) * (W - PAD * 2)) / W;
    const y = (h - PAD - ((data[i] - min) / range) * (h - PAD * 2)) / h;
    setHover({ i, x, y });
  };

  return (
    <div
      className="relative"
      style={{ height: h }}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${h}`}
        preserveAspectRatio="none"
        className="block h-full w-full"
        aria-hidden
      >
        {[0.25, 0.5, 0.75].map((f) => {
          const y = PAD + f * (h - PAD * 2);
          return (
            <line
              key={f}
              x1={PAD}
              x2={W - PAD}
              y1={y}
              y2={y}
              style={{ stroke: 'var(--border)', opacity: 0.45 }}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <path d={fill} style={{ fill: stroke, opacity: 0.1 }} />
        <path d={path} style={{ fill: 'none', stroke, strokeWidth: 1.5 }} />
        {hover ? (
          <line
            x1={hover.x * W}
            x2={hover.x * W}
            y1={PAD}
            y2={h - PAD}
            style={{ stroke: 'var(--muted-foreground)', opacity: 0.5 }}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      {showBounds && data.length > 0 ? (
        <>
          <span className="pointer-events-none absolute top-1 left-1 rounded bg-card/75 px-1 text-[10px] leading-none tabular-nums text-muted-foreground">
            {fmt(max)}
          </span>
          <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-card/75 px-1 text-[10px] leading-none tabular-nums text-muted-foreground">
            {fmt(min)}
          </span>
        </>
      ) : null}

      {hover ? (
        <>
          <span
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background"
            style={{ left: `${hover.x * 100}%`, top: `${hover.y * 100}%`, background: stroke }}
          />
          <span
            className={
              'pointer-events-none absolute z-10 -translate-y-full rounded border border-border bg-popover px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-popover-foreground shadow-sm ' +
              (hover.x > 0.8 ? '-translate-x-full' : '')
            }
            style={{
              left: `calc(${hover.x * 100}% + ${hover.x > 0.8 ? -6 : 6}px)`,
              top: `${Math.max(hover.y * 100, 18)}%`,
            }}
          >
            {fmt(data[hover.i])}
          </span>
        </>
      ) : null}
    </div>
  );
}
