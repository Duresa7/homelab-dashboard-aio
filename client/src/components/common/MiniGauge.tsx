import type { Severity } from '../../types';
import { Donut } from '../charts';

export interface MiniGaugeProps {
  value: number;
  max?: number;

  label?: string;

  sub?: string;
  size?: number;
  tone?: Severity;
  color?: string;
}

export function MiniGauge({
  value,
  max = 100,
  label,
  sub,
  size = 72,
  tone,
  color,
}: MiniGaugeProps) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <Donut
      value={value}
      max={max}
      size={size}
      thickness={Math.max(5, Math.round(size * 0.08))}
      label={label ?? `${Math.round(pct)}%`}
      sub={sub}
      kind={tone}
      color={color}
    />
  );
}
