import { Tile } from '../tile/Tile';
import { BrandIcon } from '../icons/BrandIcon';
import type { NetworkData } from '../../types';
import { pingSeverity, uptimeSeverity } from '../../lib/severity';

interface Props {
  data: NetworkData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function InternetTile({ data, span, onExpand, expandable }: Props) {
  const uptimeKind = uptimeSeverity(data.uptime30d);
  const pingKind = pingSeverity(data.speedtest.ping);
  return (
    <Tile
      title={<><BrandIcon name="unifi" alt="UniFi" /> Internet</>}
      sub={`pub ${data.publicIp}`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${data.speedtest.ping} ms`, kind: pingKind }}
    >
      <div className={`t-big text-${uptimeKind}`}>
        {data.uptime30d.toFixed(2)}
        <small>% uptime</small>
      </div>
      <div className="t-sub">30-day · {data.speedtest.down}/{data.speedtest.up} Mbps</div>
    </Tile>
  );
}
