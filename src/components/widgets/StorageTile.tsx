import { Tile } from '../tile/Tile';
import type { StorageData } from '../../types';

interface Props {
  data: StorageData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function StorageTile({ data, span, onExpand, expandable }: Props) {
  return (
    <Tile
      title="Storage Pools"
      sub={`${data.pools.length} pools`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
    >
      <div className="disks">
        {data.pools.map((p) => {
          const pct = (p.usedTB / p.totalTB) * 100;
          const cls = p.status === 'degraded' ? 'bad' : pct > 85 ? 'warn' : '';
          return (
            <div key={p.name} className="disk">
              <div className="row">
                <div className="name flex1" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 6, height: 6, borderRadius: 50,
                      background: p.status === 'degraded' ? 'var(--bad)' : 'var(--ok)',
                    }}
                  />
                  {p.name}
                  <span className="t-tag" style={{ marginLeft: 4 }}>{p.type}</span>
                </div>
                <div className="meta">
                  {p.usedTB.toFixed(1)} / {p.totalTB} TB
                </div>
              </div>
              <div className={`pbar ${cls}`}>
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}
