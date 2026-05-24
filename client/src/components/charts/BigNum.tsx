import type { ReactNode } from 'react';
import type { Severity } from '../../types';
import { severityColor } from '../../lib/severity';
import { TrendArrow } from './TrendArrow';

interface Props {
  value: ReactNode;
  unit?: string;
  sub?: string;
  accent?: boolean;
  kind?: Severity;
  /** Optional history; when provided, renders a directional trend arrow. */
  history?: number[];
  /** Direction of "good" for the trend arrow. */
  goodDirection?: 'up' | 'down';
}

export function BigNum({ value, unit, sub, accent, kind, history, goodDirection }: Props) {
  const color = kind ? severityColor[kind] : accent ? 'var(--accent)' : undefined;
  const cls = `t-big${kind === 'bad' ? ' crit' : ''}`;
  return (
    <div>
      <div className={cls} style={color ? { color } : undefined}>
        {value}
        {unit ? <small>{unit}</small> : null}
        {history && history.length >= 3 ? (
          <TrendArrow data={history} goodDirection={goodDirection} />
        ) : null}
      </div>
      {sub ? <div className="t-sub" style={{ marginTop: 6 }}>{sub}</div> : null}
    </div>
  );
}
