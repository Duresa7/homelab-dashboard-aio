import { AreaChart } from '../../charts';
import type { DashboardState } from '../../../types';
import { uptimeSeverity, pingSeverity } from '../../../lib/severity';

export function ExpandedInternet({ data }: { data: DashboardState }) {
  const n = data.network;
  const uptimeKind = uptimeSeverity(n.uptime30d);
  const pingKind = pingSeverity(n.speedtest.ping);
  return (
    <div className="ov-grid">
      <div className="tile span-6">
        <div className="t-title">Connectivity</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className={`t-big text-${uptimeKind}`}>
              {n.uptime30d.toFixed(2)}
              <small>%</small>
            </div>
            <div className="t-sub">uptime · 30d</div>
          </div>
          <div>
            <div className={`t-big text-${pingKind}`}>
              {n.speedtest.ping}
              <small>ms</small>
            </div>
            <div className="t-sub">ping</div>
          </div>
        </div>
        <dl className="kv" style={{ marginTop: 16 }}>
          <dt>Public IP</dt>
          <dd>{n.publicIp}</dd>
          <dt>Down / Up</dt>
          <dd>
            {n.speedtest.down} / {n.speedtest.up} Mbps
          </dd>
          <dt>Last speedtest</dt>
          <dd>{n.speedtest.when}</dd>
        </dl>
      </div>
      <div className="tile span-6">
        <div className="t-title">DNS resolvers</div>
        <div className="list">
          {n.dns.map((d) => (
            <div key={d.ip} className="li">
              <span className="d" />
              <span className="name">{d.name}</span>
              <span className="meta">{d.ip}</span>
              <span className="val">{d.status}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Latency history</div>
        <AreaChart data={n.latencyHistory} height={140} />
      </div>
    </div>
  );
}
