import { Tile } from '../tile/Tile';
import type { Fan } from '../../types';

interface Props {
  data: Fan[];
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function FansTile({ data, span, onExpand, expandable }: Props) {
  return (
    <Tile title="Fans" sub={`${data.length} sensors`} span={span} onExpand={onExpand} expandable={expandable}>
      <div className="col" style={{ gap: 6 }}>
        {data.map((f) => {
          const pct = (f.rpm / f.max) * 100;
          return (
            <div key={f.name} className="disk">
              <div className="row">
                <div className="name flex1">{f.name}</div>
                <div className="meta">
                  {f.rpm.toFixed(0)} <span style={{ color: 'var(--ink-4)' }}>rpm</span>
                </div>
              </div>
              <div className="pbar">
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}
