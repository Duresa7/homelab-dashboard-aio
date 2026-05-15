interface Props {
  rows: number;
  cols: number;
  data: number[];
  max?: number;
}

export function Heatmap({ cols, data, max = 100 }: Props) {
  return (
    <div className="heatmap" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {data.map((v, i) => {
        const a = Math.max(0.05, Math.min(1, v / max));
        return (
          <div
            key={i}
            className="cell"
            style={{ background: `color-mix(in oklab, var(--accent) ${a * 100}%, var(--bg-3))` }}
            title={`${v.toFixed(0)}`}
          />
        );
      })}
    </div>
  );
}
