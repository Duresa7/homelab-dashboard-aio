/**
 * Tiny directional indicator placed next to a headline metric.
 * Color reflects whether the *trend* is moving toward the healthy side,
 * which is orthogonal to the value's current severity color.
 */
interface Props {
  data: number[];
  /** Which direction is good — e.g. 'down' for temps, 'up' for uptime. */
  goodDirection?: 'up' | 'down';
  /** Window size (last N samples) used for slope; defaults to 8. */
  window?: number;
  /** Hide if slope is below this normalized threshold. */
  flatBelow?: number;
}

export function TrendArrow({ data, goodDirection = 'down', window = 8, flatBelow = 0.02 }: Props) {
  if (!data || data.length < 3) return null;
  const slice = data.slice(-window);
  const n = slice.length;
  // Simple linear regression slope.
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += slice[i];
    sxy += i * slice[i];
    sxx += i * i;
  }
  const slope = (n * sxy - sx * sy) / Math.max(n * sxx - sx * sx, 1e-6);
  const mean = sy / n;
  const normSlope = mean === 0 ? slope : slope / Math.abs(mean);
  if (Math.abs(normSlope) < flatBelow) {
    return (
      <span className="trend-arrow flat" aria-label="trend stable">
        →
      </span>
    );
  }
  const rising = slope > 0;
  const isGood = (rising && goodDirection === 'up') || (!rising && goodDirection === 'down');
  const color = isGood ? 'var(--ok)' : 'var(--bad)';
  const arrow = rising ? '↑' : '↓';
  const label = `trend ${rising ? 'rising' : 'falling'} (${isGood ? 'good' : 'bad'})`;
  return (
    <span
      className="trend-arrow"
      style={{ color, marginLeft: 6, fontSize: '0.7em', verticalAlign: 'middle' }}
      aria-label={label}
      title={label}
    >
      {arrow}
    </span>
  );
}
