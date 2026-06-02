import { AreaChart, Donut } from '../../charts';
import type { DashboardState } from '../../../types';
import { fmtTemp } from '../../../lib/units';
import { gpuTempSeverity, fanSeverity } from '../../../lib/severity';

export function ExpandedGPU({ data, unit }: { data: DashboardState; unit: 'C' | 'F' }) {
  const gpu = data.gpu;
  const tempKind = gpuTempSeverity(gpu.tempC);
  const fanKind = fanSeverity(gpu.fanPct);
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">GPU</div>
          <div className="t-sub">{gpu.model}</div>
        </div>
        <div className="metric-row">
          <Donut value={gpu.usage} label={`${gpu.usage.toFixed(0)}%`} sub="gpu" />
          <div className="meta flex1">
            <div className="v">
              <b>{gpu.memUsedGB.toFixed(1)}</b>
              <span style={{ color: 'var(--ink-3)' }}> / {gpu.memTotalGB} GB VRAM</span>
            </div>
          </div>
        </div>
        <dl className="kv">
          <dt>Power</dt>
          <dd>
            {gpu.powerW.toFixed(0)} / {gpu.powerMaxW} W
          </dd>
          <dt>Fan</dt>
          <dd className={`text-${fanKind}`}>{gpu.fanPct.toFixed(0)}%</dd>
          <dt>Temp</dt>
          <dd className={`text-${tempKind}`}>{fmtTemp(gpu.tempC, unit)}</dd>
          <dt>GPU clock</dt>
          <dd>{gpu.gpuClockMHz} MHz</dd>
          <dt>Mem clock</dt>
          <dd>{gpu.memClockMHz} MHz</dd>
        </dl>
      </div>
      <div className="tile span-12">
        <div className="t-title">Usage history</div>
        <AreaChart data={gpu.history} height={160} />
      </div>
    </div>
  );
}
