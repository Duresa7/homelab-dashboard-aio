import type { DashboardState } from '../../../types';
import { fanSeverity } from '../../../lib/severity';

export function ExpandedFans({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">All fans</div>
        <div className="col" style={{ gap: 8 }}>
          {data.fans.map((f) => {
            // Guard against missing/zero max so an unknown rated speed
            // doesn't render as Infinity% width or fake a critical band.
            const hasRated = Number.isFinite(f.max) && f.max > 0;
            const pct = hasRated ? (f.rpm / f.max) * 100 : 0;
            const kind = hasRated ? fanSeverity(pct) : 'info';
            const cls = kind === 'ok' ? '' : kind;
            return (
              <div key={f.name} className="disk">
                <div className="row">
                  <div className="name flex1">{f.name}</div>
                  <div className="meta">
                    <span className={`text-${kind}`}>{f.rpm.toFixed(0)}</span>
                    <span style={{ color: 'var(--ink-4)' }}> rpm</span>
                    <span style={{ color: 'var(--ink-3)', marginLeft: 8 }}>
                      · {pct.toFixed(0)}%
                    </span>
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
