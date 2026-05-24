import { polylinePath } from './path';
import type { Severity } from '../../types';
import { severityColor } from '../../lib/severity';

interface Props {
  data: number[];
  height?: number;
  color?: string;
  strokeWidth?: number;
  kind?: Severity;
}

export function Sparkline({ data, height = 28, color, strokeWidth = 1.25, kind }: Props) {
  const w = 100;
  const h = height;
  const d = polylinePath(data, w, h, 1);
  const stroke = kind ? severityColor[kind] : color ?? 'var(--accent)';
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: h, display: 'block' }}
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
