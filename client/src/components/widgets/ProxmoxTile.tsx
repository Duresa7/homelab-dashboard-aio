import { Tile } from '../tile/Tile';
import type { ProxmoxData } from '../../types';
import { CapabilityTitle } from '@/lib/presentation';

interface Props {
  data: ProxmoxData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function ProxmoxTile({ data, span, onExpand, expandable }: Props) {
  const { cluster, nodes } = data;
  const running = cluster.guestsRunning;
  const total = cluster.guestsTotal;
  const down = cluster.nodesTotal - cluster.nodesOnline;
  return (
    <Tile
      title={<CapabilityTitle capability="datacenter" />}
      sub={`${cluster.nodesOnline}/${cluster.nodesTotal} nodes online`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${running}/${total} guests`, kind: down > 0 ? 'warn' : 'ok' }}
    >
      <div className="t-big">
        {running}
        <small> / {total} guests</small>
      </div>
      <div className="t-sub">
        {cluster.cpuUsed.toFixed(1)} / {cluster.cpuTotal} cores · RAM {cluster.memPct.toFixed(0)}%
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {nodes.slice(0, 4).map((node) => (
          <span
            key={node.name}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground"
          >
            <span className={`d ${node.status === 'online' ? '' : 'warn'}`} />
            <span className="font-medium text-foreground">{node.name}</span>
            <span>{node.cpu.toFixed(0)}%</span>
            <span>{node.ram.toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </Tile>
  );
}
