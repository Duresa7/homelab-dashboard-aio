interface Props {
  value: number;
  max?: number;
  size?: number;
  label?: string;
  sub?: string;
  color?: string;
  thickness?: number;
}

export function Donut({
  value,
  max = 100,
  size = 96,
  label,
  sub,
  color = 'var(--accent)',
  thickness = 8,
}: Props) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="donut" style={{ width: size, height: size }}>
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" className="track"
        strokeWidth={thickness} style={{ stroke: 'var(--bg-3)' }}
      />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" className="arc"
        strokeWidth={thickness} strokeLinecap="round"
        style={{ stroke: color }}
        strokeDasharray={`${(c * pct).toFixed(2)} ${c.toFixed(2)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: size * 0.22, fontWeight: 600, fill: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
      >
        {label}
      </text>
      {sub ? (
        <text x="50%" y={size * 0.68} textAnchor="middle" style={{ fontSize: size * 0.1, fill: 'var(--ink-3)' }}>
          {sub}
        </text>
      ) : null}
    </svg>
  );
}
