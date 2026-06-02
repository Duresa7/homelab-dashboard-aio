import { AreaChart } from '../../charts';
import type { DashboardState } from '../../../types';

export function ExpandedNetwork({ data }: { data: DashboardState }) {
  const n = data.network;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Throughput</div>
        <div className="netrate">
          <div className="col">
            <div className="label">↓ download</div>
            <div className="v">
              {n.downHistory[n.downHistory.length - 1].toFixed(0)}
              <small>Mbps</small>
            </div>
            <AreaChart data={n.downHistory} height={80} />
          </div>
          <div className="col">
            <div className="label">↑ upload</div>
            <div className="v">
              {n.upHistory[n.upHistory.length - 1].toFixed(0)}
              <small>Mbps</small>
            </div>
            <AreaChart data={n.upHistory} height={80} />
          </div>
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Metrics</div>
        <dl className="kv">
          <dt>Latency</dt>
          <dd>{n.latencyMs.toFixed(1)} ms</dd>
          <dt>Last speedtest</dt>
          <dd>
            {n.speedtest.down}/{n.speedtest.up} Mbps · ping {n.speedtest.ping} ms
          </dd>
          <dt>Uptime 30d</dt>
          <dd>{n.uptime30d.toFixed(2)}%</dd>
          <dt>Public IP</dt>
          <dd>{n.publicIp}</dd>
        </dl>
      </div>
    </div>
  );
}
