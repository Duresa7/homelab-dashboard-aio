import { Tile } from '../tile/Tile';
import type { UnifiData } from '../../types';

interface Props {
  data: UnifiData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function UnifiTile({ data, span, onExpand, expandable }: Props) {
  const { gateway, switches, aps, clients, clientBreakdown, wan } = data;
  return (
    <Tile
      title="Network"
      sub={gateway.model}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${clients} clients`, kind: 'ok' }}
    >
      <div className="row" style={{ gap: 14 }}>
        <div className="flex1">
          <div className="t-sub">Gateway CPU</div>
          <div className="t-big" style={{ fontSize: 22 }}>
            {gateway.cpu.toFixed(0)}<small>%</small>
          </div>
        </div>
        <div className="flex1">
          <div className="t-sub">Gateway RAM</div>
          <div className="t-big" style={{ fontSize: 22 }}>
            {gateway.ram.toFixed(0)}<small>%</small>
          </div>
        </div>
        <div className="flex1">
          <div className="t-sub">Uptime</div>
          <div className="t-big mono" style={{ fontSize: 18 }}>{gateway.uptime}</div>
        </div>
      </div>
      <div className="netrate">
        <div className="col">
          <div className="label">↓ wan down</div>
          <div className="v">{wan.down}<small>Mbps</small></div>
          <div className="pbar"><span style={{ width: `${(wan.down / wan.downMax) * 100}%` }} /></div>
        </div>
        <div className="col">
          <div className="label">↑ wan up</div>
          <div className="v">{wan.up}<small>Mbps</small></div>
          <div className="pbar"><span style={{ width: `${(wan.up / wan.upMax) * 100}%` }} /></div>
        </div>
      </div>
      <div className="t-sub" style={{ paddingTop: 6, borderTop: '1px dashed var(--line)' }}>
        Clients:&nbsp;
        <span style={{ color: 'var(--accent)' }}>{clientBreakdown.wireless} wireless</span>
        {' · '}
        {clientBreakdown.wired} wired
        {clientBreakdown.vpn > 0 && <>{' · '}{clientBreakdown.vpn} VPN</>}
      </div>
      <div className="list">
        {aps.map((ap) => (
          <div key={ap.name} className="li">
            <span className="d" />
            <span className="name">{ap.name}</span>
            <span className="meta">{ap.model}</span>
            <span className="val">
              {ap.clients} cli
            </span>
          </div>
        ))}
      </div>
      <div className="t-sub" style={{ paddingTop: 6, borderTop: '1px dashed var(--line)' }}>
        Switches:&nbsp;
        {switches.map((s, i) => (
          <span key={s.name}>
            {s.name}{s.poeUsedW > 0 ? ` (${s.poeUsedW}W)` : ''}
            {i < switches.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </div>
    </Tile>
  );
}
