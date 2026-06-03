import { Tile } from '../tile/Tile';
import type { ProxmoxData } from '../../types';

interface Props {
  data: ProxmoxData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function ProxmoxTile({ data, span, onExpand, expandable }: Props) {
  const { node, vms, coresAllocated, coresTotal } = data;
  const running = vms.filter((v) => v.state === 'running').length;
  const stopped = vms.length - running;
  return (
    <Tile
      title="Data Center"
      sub={node.name}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${running}/${vms.length} up`, kind: stopped > 1 ? 'warn' : 'ok' }}
    >
      <div className="t-big">
        {running}
        <small> / {vms.length} VMs</small>
      </div>
      <div className="t-sub">
        {coresAllocated} / {coresTotal} cores · CPU {node.cpu.toFixed(0)}%
      </div>
    </Tile>
  );
}
