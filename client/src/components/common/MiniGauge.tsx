import type { Severity } from '../../types';
import { Donut } from '../charts';

export interface MiniGaugeProps {
  /** Value 0–max. */
  value: number;
  max?: number;
  /** Center label, e.g. "62%". Defaults to rounded percentage. */
  label?: string;
  /** Caption under the value, e.g. "CPU". */
  sub?: string;
  size?: number;
  tone?: Severity;
  color?: string;
}

/**
 * Small circular gauge — a thin wrapper over the SVG Donut tuned for in-card
 * use (compact size, thinner ring). Use where a radial read is clearer than a
 * bar (single headline metric on a drill-in pane).
 */
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
