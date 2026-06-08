import { polylinePath } from './path';
import type { Severity } from '../../types';
import { severityColor } from '../../lib/severity';

interface Props {
  data: number[];
  height?: number;
  color?: string;
  kind?: Severity;
}

export function AreaChart({ data, height = 56, color, kind }: Props) {
  const w = 200;
  const h = height;
  const path = polylinePath(data, w, h, 2);
  const fill = path ? `${path} L${w - 2},${h - 2} L2,${h - 2} Z` : '';
  const stroke = kind ? severityColor[kind] : (color ?? 'var(--accent)');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height: h }}
    >
      <path d={fill} style={{ fill: stroke, opacity: 0.1 }} />
      <path d={path} style={{ fill: 'none', stroke, strokeWidth: 1.5 }} />
    </svg>
  );
}
