import { AreaChart } from '../components/charts';
import { InternetTile, NetworkTile, TopTalkersTile } from '../components/widgets';
import type { DashboardState } from '../types';
import { fmtTemp, useTempUnit } from '../lib/units';

interface Props {
  data: DashboardState;
}

export function NetworkPage({ data }: Props) {
  const u = data.unifi;
  const { unit } = useTempUnit();
  return (
    <div className="grid">
      <div className="tile span-4">
        <div className="t-title">Gateway</div>
        <div className="t-big" style={{ fontSize: 22 }}>{u.gateway.model}</div>
        <dl className="kv">
          <dt>Firmware</dt><dd>{u.gateway.fwVersion}</dd>
          <dt>Uptime</dt><dd>{u.gateway.uptime}</dd>
          <dt>CPU</dt><dd>{u.gateway.cpu.toFixed(0)}%</dd>
          <dt>RAM</dt><dd>{u.gateway.ram.toFixed(0)}%</dd>
          <dt>Temp</dt><dd>{fmtTemp(u.gateway.tempC, unit)}</dd>
          <dt>Public IP</dt><dd>{u.wan.public}</dd>
          {u.appVersion && <><dt>App Version</dt><dd>{u.appVersion}</dd></>}
        </dl>
      </div>
      <NetworkTile data={data.network} span={8} chartKind="area" expandable={false} />
      <div className="tile span-6">
        <div className="t-title">Wi-Fi Access Points</div>
        <div className="list">
          {u.aps.length === 0 && <div className="t-sub">No APs detected</div>}
          {u.aps.map((ap) => (
            <div key={ap.name} className="li">
              <span className="d" style={{ background: ap.state === 'ONLINE' ? 'var(--ok)' : 'var(--bad)' }} />
              <span className="name">{ap.name}</span>
              <span className="meta">
                {ap.model}
                {ap.channel !== 'n/a' && ` · ch${ap.channel}`}
                {ap.frequency && ` ${ap.frequency}GHz`}
              </span>
              <span className="val">
                {ap.clients} clients
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Switches &amp; PoE</div>
        {u.switches.length === 0 && <div className="t-sub">No switches detected</div>}
        <div className="disks">
          {u.switches.map((s) => {
            const pct = s.poeMaxW ? (s.poeUsedW / s.poeMaxW) * 100 : 0;
            return (
              <div key={s.name} className="disk">
                <div className="row">
                  <div className="name flex1">
                    <span className="d" style={{ background: s.state === 'ONLINE' ? 'var(--ok)' : 'var(--bad)', display: 'inline-block', marginRight: 6 }} />
                    {s.name}
                  </div>
                  <div className="meta">{s.model}</div>
                </div>
                {s.poeMaxW > 0 && (
                  <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <div className="meta" style={{ minWidth: 50 }}>PoE</div>
                    <div className="pbar flex1">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <div className="meta">{s.poeUsedW}/{s.poeMaxW} W</div>
                  </div>
                )}
                <div className="meta">{s.portsUp}/{s.ports} ports up · {s.portsActive} clients</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Networks &amp; VLANs</div>
        {u.networks.length === 0 && <div className="t-sub">No networks data</div>}
        <div className="list">
          {u.networks.map((n) => (
            <div key={n.id} className="li">
              <span className="d" style={{ background: n.enabled ? 'var(--ok)' : 'var(--bad)' }} />
              <span className="name">{n.name}</span>
              <span className="meta">
                {n.vlanId !== null ? `VLAN ${n.vlanId}` : 'Default'}
                {n.isDefault ? ' · default' : ''}
              </span>
              <span className="val">{n.management}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Wi-Fi SSIDs</div>
        {u.ssids.length === 0 && <div className="t-sub">No SSID data</div>}
        <div className="list">
          {u.ssids.map((s) => (
            <div key={s.id} className="li">
              <span className="d" style={{ background: s.enabled ? 'var(--ok)' : 'var(--bad)' }} />
              <span className="name">{s.name}</span>
              <span className="meta">
                {s.security}
                {s.broadcastingFrequencies.length > 0 &&
                  ` · ${s.broadcastingFrequencies.map(f => `${f}GHz`).join(', ')}`
                }
              </span>
              <span className="val">{s.enabled ? 'active' : 'disabled'}</span>
            </div>
          ))}
        </div>
      </div>
      <TopTalkersTile data={u.topTalkers} span={6} expandable={false} />
      <InternetTile data={data.network} span={6} expandable={false} />
      <div className="tile span-4">
        <div className="t-title">Firewall</div>
        <dl className="kv">
          <dt>Zones</dt><dd>{u.firewall.zones}</dd>
          <dt>Policies</dt><dd>{u.firewall.policiesEnabled}/{u.firewall.policies} enabled</dd>
        </dl>
      </div>
      <div className="tile span-4">
        <div className="t-title">VPN Servers</div>
        {u.vpnServers.length === 0 && <div className="t-sub">No VPN servers</div>}
        <div className="list">
          {u.vpnServers.map((v) => (
            <div key={v.id} className="li">
              <span className="d" style={{ background: v.enabled ? 'var(--ok)' : 'var(--bad)' }} />
              <span className="name">{v.name}</span>
              <span className="meta">{v.type}</span>
              <span className="val">{v.enabled ? 'active' : 'disabled'}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tile span-4">
        <div className="t-title">DNS Records</div>
        {u.dnsRecords.length === 0 && <div className="t-sub">No local DNS records</div>}
        <div className="list">
          {u.dnsRecords.map((r) => (
            <div key={r.id} className="li">
              <span className="d" style={{ background: r.enabled ? 'var(--ok)' : 'var(--bad)' }} />
              <span className="name">{r.domain}</span>
              <span className="val">{r.type}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Latency · last 60 ticks</div>
        <AreaChart data={data.network.latencyHistory} height={120} />
        <dl className="kv">
          <dt>Current</dt><dd>{data.network.latencyMs.toFixed(1)} ms</dd>
          <dt>Min</dt><dd>{Math.min(...data.network.latencyHistory).toFixed(1)} ms</dd>
          <dt>Max</dt><dd>{Math.max(...data.network.latencyHistory).toFixed(1)} ms</dd>
        </dl>
      </div>
    </div>
  );
}
