import type { DashboardState } from '../../../types';

export function ExpandedUnifi({ data }: { data: DashboardState }) {
  const { gateway, clients, clientBreakdown, wan, switches, aps } = data.unifi;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Gateway · {gateway.model}</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {gateway.cpu.toFixed(0)}
              <small>%</small>
            </div>
            <div className="t-sub">CPU</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {gateway.ram.toFixed(0)}
              <small>%</small>
            </div>
            <div className="t-sub">RAM</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 22 }}>
              {gateway.uptime}
            </div>
            <div className="t-sub">uptime</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {clients}
            </div>
            <div className="t-sub">clients</div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">WAN</div>
        <div className="netrate">
          <div className="col">
            <div className="label">↓ down</div>
            <div className="v">
              {wan.down}
              <small>Mbps</small>
            </div>
            <div className="pbar">
              <span style={{ width: `${(wan.down / wan.downMax) * 100}%` }} />
            </div>
          </div>
          <div className="col">
            <div className="label">↑ up</div>
            <div className="v">
              {wan.up}
              <small>Mbps</small>
            </div>
            <div className="pbar">
              <span style={{ width: `${(wan.up / wan.upMax) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Client breakdown</div>
        <dl className="kv">
          <dt>Wireless</dt>
          <dd>{clientBreakdown.wireless}</dd>
          <dt>Wired</dt>
          <dd>{clientBreakdown.wired}</dd>
          {clientBreakdown.vpn > 0 ? (
            <>
              <dt>VPN</dt>
              <dd>{clientBreakdown.vpn}</dd>
            </>
          ) : null}
        </dl>
      </div>
      {switches.length > 0 ? (
        <div className="tile span-6">
          <div className="t-title">Switches</div>
          <div className="list">
            {switches.map((s) => (
              <div key={s.name} className="li">
                <span className={`d ${s.state === 'connected' ? '' : 'warn'}`} />
                <span className="name">{s.name}</span>
                <span className="meta">{s.model}</span>
                <span className="val">
                  {s.portsActive}/{s.ports} ports
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {aps.length > 0 ? (
        <div className="tile span-6">
          <div className="t-title">Access points</div>
          <div className="list">
            {aps.map((ap) => (
              <div key={ap.name} className="li">
                <span className={`d ${ap.state === 'connected' ? '' : 'warn'}`} />
                <span className="name">{ap.name}</span>
                <span className="meta">{ap.channel}</span>
                <span className="val">{ap.clients} clients</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
