import type { DashboardState } from '../../../types';
import { fmtTemp, convertTemp, tempSuffix } from '../../../lib/units';
import { formatPowerOnTime } from '../../../lib/format';
import { diskTempSeverity } from '../../../lib/severity';

export function ExpandedSmart({ data, unit }: { data: DashboardState; unit: 'C' | 'F' }) {
  const disks = data.storage.disks;
  const ok = disks.filter((d) => d.smart === 'ok').length;
  const warn = disks.filter((d) => d.smart === 'warn').length;
  const bad = disks.filter((d) => d.smart === 'bad').length;
  const avgC = disks.length ? disks.reduce((a, b) => a + b.tempC, 0) / disks.length : 0;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Summary</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className="t-big text-ok" style={{ fontSize: 32 }}>
              {ok}
            </div>
            <div className="t-sub">healthy</div>
          </div>
          <div>
            <div className="t-big text-warn" style={{ fontSize: 32 }}>
              {warn}
            </div>
            <div className="t-sub">warning</div>
          </div>
          <div>
            <div className="t-big text-bad" style={{ fontSize: 32 }}>
              {bad}
            </div>
            <div className="t-sub">failing</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 32 }}>
              {Math.round(convertTemp(avgC, unit))}
              <small>{tempSuffix(unit)}</small>
            </div>
            <div className="t-sub">avg temp</div>
          </div>
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">All drives</div>
        <div className="list">
          {disks.map((d) => (
            <div key={d.name} className="li">
              <span
                className={`d ${d.smart === 'bad' ? 'bad' : d.smart === 'warn' ? 'warn' : ''}`}
              />
              <span className="name">{d.name}</span>
              <span className="meta">{d.model}</span>
              <span className="val">
                <span className={`text-${diskTempSeverity(d.tempC)}`}>
                  {fmtTemp(d.tempC, unit)}
                </span>
                <span style={{ color: 'var(--ink-3)', marginLeft: 8 }}>
                  · {formatPowerOnTime(d.ageHours)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
