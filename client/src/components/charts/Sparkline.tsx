import { polylinePath } from './path';

interface Props {
  data: number[];
  height?: number;
  color?: string;
  strokeWidth?: number;
}

export function Sparkline({ data, height = 28, color = 'var(--accent)', strokeWidth = 1.25 }: Props) {
  const w = 100;
  const h = height;
  const d = polylinePath(data, w, h, 1);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: h, display: 'block' }}
    >
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
