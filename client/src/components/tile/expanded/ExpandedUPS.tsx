import { Donut } from '../../charts';
import type { DashboardState } from '../../../types';
import { batterySeverity } from '../../../lib/severity';

export function ExpandedUPS({ data }: { data: DashboardState }) {
  const ups = data.ups;
  const batteryKind = batterySeverity(ups.batteryPct);
  return (
    <div className="ov-grid">
      <div className="tile span-6">
        <div className="t-title">Battery</div>
        <div className="metric-row">
          <Donut
            value={ups.batteryPct}
            label={`${ups.batteryPct}%`}
            sub="battery"
            kind={batteryKind}
          />
          <div className="meta flex1">
            <div className="v">
              <b>{ups.runtimeMin}</b>
              <span style={{ color: 'var(--ink-3)' }}> min runtime</span>
            </div>
            <div className="lbl">status · {ups.status}</div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Load</div>
        <div className="t-big">
          {ups.loadW}
          <small> W</small>
        </div>
        <div className="t-sub">{ups.loadPct}% of rated capacity</div>
        <div className="pbar" style={{ marginTop: 8 }}>
          <span style={{ width: `${ups.loadPct}%` }} />
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Model</dt>
          <dd>{ups.model}</dd>
        </dl>
      </div>
    </div>
  );
}
