interface Props {
  value: number;
  max?: number;
  label?: string;
  sub?: string;
  color?: string;
}

export function Gauge({ value, max = 100, label, sub, color = 'var(--accent)' }: Props) {
  const w = 200;
  const h = 110;
  const cx = w / 2;
  const cy = h - 8;
  const r = 78;
  const start = Math.PI;
  const end = 0;
  const pct = Math.max(0, Math.min(1, value / max));
  const ang = start + (end - start) * pct;
  const sx = cx + r * Math.cos(start);
  const sy = cy + r * Math.sin(start);
  const ex = cx + r * Math.cos(ang);
  const ey = cy + r * Math.sin(ang);
  const fx = cx + r * Math.cos(end);
  const fy = cy + r * Math.sin(end);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block w-full" style={{ width: '100%', height: h }}>
      <path
        d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${fx} ${fy}`}
        fill="none"
        strokeWidth={10}
        style={{ stroke: 'var(--bg-3)' }}
      />
      <path
        d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`}
        fill="none"
        strokeWidth={10}
        strokeLinecap="round"
        style={{ stroke: color }}
      />
      <text
        x="50%"
        y={h - 28}
        textAnchor="middle"
        style={{
          fontSize: 30,
          fontWeight: 600,
          fill: 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {label}
      </text>
      {sub ? (
        <text x="50%" y={h - 8} textAnchor="middle" style={{ fontSize: 12, fill: 'var(--ink-3)' }}>
          {sub}
        </text>
      ) : null}
    </svg>
  );
}
