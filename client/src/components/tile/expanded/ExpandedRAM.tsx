import { AreaChart, Donut } from '../../charts';
import type { DashboardState } from '../../../types';

export function ExpandedRAM({ data }: { data: DashboardState }) {
  const ram = data.ram;
  const pct = (ram.usedGB / ram.totalGB) * 100;
  const freeGB = ram.totalGB - ram.usedGB;
  return (
    <div className="ov-grid">
      <div className="tile span-6">
        <div className="t-title">Memory</div>
        <div className="metric-row">
          <Donut value={pct} label={`${pct.toFixed(0)}%`} sub="used" />
          <div className="meta flex1">
            <div className="v">
              <b>{ram.usedGB.toFixed(1)}</b>
              <span style={{ color: 'var(--ink-3)' }}> / {ram.totalGB} GB</span>
            </div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Breakdown</div>
        <dl className="kv">
          <dt>Used</dt>
          <dd>{ram.usedGB.toFixed(2)} GB</dd>
          <dt>Cached</dt>
          <dd>{ram.cachedGB.toFixed(2)} GB</dd>
          <dt>Free</dt>
          <dd>{freeGB.toFixed(2)} GB</dd>
          <dt>Total</dt>
          <dd>{ram.totalGB} GB</dd>
        </dl>
      </div>
      <div className="tile span-12">
        <div className="t-title">Usage history</div>
        <AreaChart data={ram.history} height={160} />
      </div>
    </div>
  );
}
