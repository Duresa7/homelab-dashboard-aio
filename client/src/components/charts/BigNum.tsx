import type { ReactNode } from 'react';

interface Props {
  value: ReactNode;
  unit?: string;
  sub?: string;
  accent?: boolean;
}

export function BigNum({ value, unit, sub, accent }: Props) {
  return (
    <div>
      <div className="t-big" style={accent ? { color: 'var(--accent)' } : undefined}>
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {sub ? <div className="t-sub" style={{ marginTop: 6 }}>{sub}</div> : null}
    </div>
  );
}
