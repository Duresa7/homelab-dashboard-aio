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
  const stopped = vms.filter((v) => v.state !== 'running').length;
  return (
    <Tile
      title="Proxmox"
      sub={`${node.name} · v${node.version}`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${running}/${vms.length} up`, kind: stopped > 1 ? 'warn' : 'ok' }}
    >
      <div className="row" style={{ gap: 14 }}>
        <div className="flex1">
          <div className="t-sub">Cores allocated</div>
          <div className="t-big" style={{ fontSize: 28 }}>
            {coresAllocated}<small>/ {coresTotal}</small>
          </div>
          <div className="pbar" style={{ marginTop: 4 }}>
            <span style={{ width: `${(coresAllocated / coresTotal) * 100}%` }} />
          </div>
        </div>
        <div className="flex1">
          <div className="t-sub">Node CPU</div>
          <div className="t-big" style={{ fontSize: 28 }}>
            {node.cpu.toFixed(0)}<small>%</small>
          </div>
          <div className="pbar" style={{ marginTop: 4 }}>
            <span style={{ width: `${node.cpu}%` }} />
          </div>
        </div>
        <div className="flex1">
          <div className="t-sub">Node RAM</div>
          <div className="t-big" style={{ fontSize: 28 }}>
            {node.ram.toFixed(0)}<small>%</small>
          </div>
          <div className="pbar" style={{ marginTop: 4 }}>
            <span style={{ width: `${node.ram}%` }} />
          </div>
        </div>
      </div>
    </Tile>
  );
}
