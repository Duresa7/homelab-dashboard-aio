interface Props {
  data: number[];
  height?: number;
  max?: number;
  warnAt?: number;
  badAt?: number;
}

export function Bars({ data, height = 40, max, warnAt, badAt }: Props) {
  const m = max || Math.max(...data, 1);
  return (
    <div className="flex w-full items-end gap-[3px]" style={{ height }}>
      {data.map((v, i) => {
        const color =
          badAt && v >= badAt
            ? 'var(--bad)'
            : warnAt && v >= warnAt
              ? 'var(--warn)'
              : 'var(--accent)';
        return (
          <div
            key={i}
            className="min-h-0.5 flex-1 rounded-t-[2px]"
            style={{
              height: `${(v / m) * 100}%`,
              background: color,
              opacity: 0.92,
              transition: 'height 0.4s ease',
            }}
          />
        );
      })}
    </div>
  );
}
