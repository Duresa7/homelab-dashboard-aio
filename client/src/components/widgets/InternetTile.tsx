import { Tile } from '../tile/Tile';
import { BrandIcon } from '../icons/BrandIcon';
import type { NetworkData } from '../../types';
import { severityColor, pingSeverity, uptimeSeverity } from '../../lib/severity';

interface Props {
  data: NetworkData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function InternetTile({ data, span, onExpand, expandable }: Props) {
  return (
    <Tile title={<><BrandIcon name="unifi" alt="UniFi" /> Internet</>} sub={`pub ${data.publicIp}`} span={span} onExpand={onExpand} expandable={expandable}>
      <div className="row" style={{ gap: 14 }}>
        <div>
          <div className="t-big" style={{ color: severityColor[uptimeSeverity(data.uptime30d)] }}>
            {data.uptime30d.toFixed(2)}<small>%</small>
          </div>
          <div className="t-sub">uptime · 30d</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 26, color: severityColor[pingSeverity(data.speedtest.ping)] }}>
            {data.speedtest.ping}<small>ms</small>
          </div>
          <div className="t-sub">last ping</div>
        </div>
      </div>
      <div className="list">
        {data.dns.map((d) => (
          <div key={d.ip} className="li">
            <span className="d" />
            <span className="name">{d.name}</span>
            <span className="meta">{d.ip}</span>
            <span className="val">ok</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
