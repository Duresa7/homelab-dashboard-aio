import type { DashboardState } from '../../../types';

export function ExpandedTopTalkers({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">All connected clients</div>
        <div className="list">
          {data.unifi.topTalkers.map((t) => (
            <div key={`${t.name}-${t.ip}`} className="li">
              <span className="d" />
              <span className="name">{t.name}</span>
              <span className="meta">
                {t.ip} · {t.type.toLowerCase()}
              </span>
              <span className="val">
                ↓{t.rxMB.toFixed(0)} ↑{t.txMB.toFixed(0)} MB
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
