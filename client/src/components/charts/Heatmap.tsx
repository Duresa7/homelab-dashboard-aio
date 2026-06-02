interface Props {
  cols: number;
  data: number[];
  max?: number;
  /** Threshold (as fraction 0..1) at which color transitions warn→bad. */
  warnAt?: number;
  badAt?: number;
}

/**
 * Severity-tinted heatmap: cells interpolate ok → warn → bad based on
 * normalized value. Lower values fade toward the page surface so the
 * "hot" cells visually pop.
 */
export function Heatmap({ cols, data, max = 100, warnAt = 0.6, badAt = 0.85 }: Props) {
  return (
    <div className="heatmap" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {data.map((v, i) => {
        const norm = Math.max(0, Math.min(1, v / max));
        let baseColor: string;
        let blend: number;
        if (norm >= badAt) {
          baseColor = 'var(--bad)';
          // ramp from 70% at badAt to 100% at full
          blend = 70 + ((norm - badAt) / Math.max(1 - badAt, 0.01)) * 30;
        } else if (norm >= warnAt) {
          baseColor = 'var(--warn)';
          blend = 50 + ((norm - warnAt) / Math.max(badAt - warnAt, 0.01)) * 30;
        } else {
          baseColor = 'var(--ok)';
          // low values fade toward background
          blend = 15 + (norm / Math.max(warnAt, 0.01)) * 40;
        }
        return (
          <div
            key={i}
            className="cell"
            style={{
              background: `color-mix(in oklab, ${baseColor} ${blend.toFixed(0)}%, var(--bg-3))`,
            }}
            title={`${v.toFixed(0)}`}
          />
        );
      })}
    </div>
  );
}
