import type { DashboardState } from '../../../types';
import { fmtTemp } from '../../../lib/units';
import { formatPowerOnTime } from '../../../lib/format';

export function ExpandedUnas({ data, unit }: { data: DashboardState; unit: 'C' | 'F' }) {
  const { pools, disks } = data.unas;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Pools</div>
        <div className="disks">
          {pools.map((p) => {
            const pct = p.totalTB > 0 ? (p.usedTB / p.totalTB) * 100 : 0;
            const cls = p.status === 'offline' ? 'bad' : p.status === 'degraded' ? 'warn' : 'ok';
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
                        background:
                          cls === 'ok'
                            ? 'var(--ok)'
                            : cls === 'warn'
                              ? 'var(--warn)'
                              : 'var(--bad)',
                      }}
                    />
                    {p.name}
                    <span className="t-tag">{p.type}</span>
                  </div>
                  <div className="meta">
                    {p.usedTB.toFixed(2)} / {p.totalTB.toFixed(2)} TB
                  </div>
                </div>
                <div className={`pbar ${cls === 'ok' ? '' : cls}`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Drives</div>
        <div className="list">
          {disks.map((d) => (
            <div key={d.slot} className="li">
              <span
                className={`d ${d.smart === 'bad' ? 'bad' : d.smart === 'warn' ? 'warn' : ''}`}
              />
              <span className="name">
                Slot {d.slot} · {d.model}
              </span>
              <span className="meta">{formatPowerOnTime(d.powerOnHours)}</span>
              <span className="val">{fmtTemp(d.tempC, unit)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
