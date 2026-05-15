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
    <div className="bar-strip" style={{ height }}>
      {data.map((v, i) => {
        const cls = badAt && v >= badAt ? 'bad' : warnAt && v >= warnAt ? 'warn' : '';
        return <div key={i} className={`b ${cls}`} style={{ height: `${(v / m) * 100}%` }} />;
      })}
    </div>
  );
}
