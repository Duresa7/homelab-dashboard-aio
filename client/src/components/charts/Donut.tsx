import type { Severity } from '../../types';
import { severityColor } from '../../lib/severity';

interface Props {
  value: number;
  max?: number;
  size?: number;
  label?: string;
  sub?: string;
  color?: string;
  thickness?: number;
  kind?: Severity;
}

export function Donut({
  value,
  max = 100,
  size = 96,
  label,
  sub,
  color,
  thickness = 6,
  kind,
}: Props) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const stroke = kind ? severityColor[kind] : (color ?? 'var(--accent)');
  const labelFill = kind ? severityColor[kind] : 'var(--ink)';
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="donut" style={{ width: size, height: size }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className="track"
        strokeWidth={thickness}
        style={{ stroke: 'var(--bg-3)' }}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className="arc"
        strokeWidth={thickness}
        strokeLinecap="round"
        style={{ stroke }}
        strokeDasharray={`${(c * pct).toFixed(2)} ${c.toFixed(2)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y={sub ? '46%' : '50%'}
        textAnchor="middle"
        dominantBaseline="central"
        className={kind === 'bad' ? 'crit' : undefined}
        style={{
          fontSize: size * 0.22,
          fontWeight: 600,
          fill: labelFill,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--font-sans)',
          letterSpacing: '-0.02em',
        }}
      >
        {label}
      </text>
      {sub ? (
        <text
          x="50%"
          y={size * 0.66}
          textAnchor="middle"
          style={{
            fontSize: size * 0.1,
            fill: 'var(--ink-3)',
            fontFamily: 'var(--font-sans)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {sub}
        </text>
      ) : null}
    </svg>
  );
}
