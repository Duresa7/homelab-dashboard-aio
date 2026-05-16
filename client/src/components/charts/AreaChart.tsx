import { polylinePath } from './path';

interface Props {
  data: number[];
  height?: number;
  color?: string;
}

export function AreaChart({ data, height = 56, color = 'var(--accent)' }: Props) {
  const w = 200;
  const h = height;
  const path = polylinePath(data, w, h, 2);
  const fill = path ? `${path} L${w - 2},${h - 2} L2,${h - 2} Z` : '';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="chart-area" style={{ height: h }}>
      <path d={fill} className="fill" style={{ fill: color, opacity: 0.10 }} />
      <path d={path} className="line" style={{ stroke: color }} />
    </svg>
  );
}
