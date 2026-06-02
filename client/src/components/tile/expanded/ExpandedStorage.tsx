import type { DashboardState } from '../../../types';
import { fillSeverity } from '../../../lib/severity';

export function ExpandedStorage({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Pools</div>
        <div className="disks">
          {data.storage.pools.map((p) => {
            const pct = p.totalTB > 0 ? (p.usedTB / p.totalTB) * 100 : 0;
            const fillKind = p.status === 'degraded' ? 'bad' : fillSeverity(pct);
            const cls = fillKind === 'ok' ? '' : fillKind;
            return (
              <div key={p.name} className="disk">
                <div className="row">
                  <div
                    className="name flex1"
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 50,
                        background: p.status === 'degraded' ? 'var(--bad)' : 'var(--ok)',
                      }}
                    />
                    {p.name}
                    <span className="t-tag" style={{ marginLeft: 4 }}>
                      {p.type}
                    </span>
                  </div>
                  <div className="meta">
                    <span className={`text-${fillKind}`}>{p.usedTB.toFixed(2)}</span> /{' '}
                    {p.totalTB.toFixed(2)} TB
                  </div>
                </div>
                <div className={`pbar ${cls}`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
