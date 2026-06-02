import { Tile } from '../tile/Tile';
import type { UnifiData } from '../../types';

interface Props {
  data: UnifiData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function UnifiTile({ data, span, onExpand, expandable }: Props) {
  const { gateway, clients, wan } = data;
  return (
    <Tile
      title="Network"
      sub={gateway.model}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${clients} clients`, kind: 'ok' }}
    >
      <div className="t-big">
        {clients}
        <small> clients online</small>
      </div>
      <div className="netrate">
        <div className="col">
          <div className="label">↓ wan</div>
          <div className="v">
            {wan.down}
            <small>Mbps</small>
          </div>
        </div>
        <div className="col">
          <div className="label">↑ wan</div>
          <div className="v">
            {wan.up}
            <small>Mbps</small>
          </div>
        </div>
      </div>
    </Tile>
  );
}
