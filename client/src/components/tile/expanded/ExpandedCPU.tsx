import type { CSSProperties } from 'react';
import { AreaChart, Donut } from '../../charts';
import type { DashboardState } from '../../../types';
import { fmtTemp, useTempUnit } from '../../../lib/units';
import { cpuTempSeverity, cpuUsageSeverity } from '../../../lib/severity';

export function ExpandedCPU({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const cpu = data.cpu;
  const usageKind = cpuUsageSeverity(cpu.usage);
  const tempKind = cpuTempSeverity(cpu.tempC);
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">CPU</div>
          <div className="t-sub">{cpu.model}</div>
        </div>
        <div className="metric-row">
          <Donut
            value={cpu.usage}
            label={`${cpu.usage.toFixed(0)}%`}
            sub="usage"
            kind={usageKind}
          />
          <div className="meta flex1">
            <div className="v">
              <b>{((cpu.usage / 100) * cpu.cores).toFixed(1)}</b>
              <span style={{ color: 'var(--ink-3)' }}> / {cpu.cores} cores busy · </span>
              <b className={`text-${tempKind}`}>{fmtTemp(cpu.tempC, unit)}</b>
            </div>
          </div>
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">All cores · live</div>
        <div className="cores" style={{ gridTemplateColumns: 'repeat(16, 1fr)' }}>
          {cpu.coreList.map((c) => {
            const cls = c.pct > 85 ? 'bad' : c.pct > 65 ? 'warn' : '';
            return (
              <div
                key={c.id}
                className={`core ${cls}`}
                style={{ '--p': `${c.pct.toFixed(0)}%`, height: 36 } as CSSProperties}
              >
                <span>{c.pct.toFixed(0)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Usage history</div>
        <AreaChart data={cpu.history} height={140} />
      </div>
      <div className="tile span-6">
        <div className="t-title">Temperature history</div>
        <AreaChart data={cpu.tempHistory} height={140} color="var(--warn)" />
      </div>
    </div>
  );
}
