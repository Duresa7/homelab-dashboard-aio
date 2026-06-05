import { Tile } from '../tile/Tile';
import type { TopTalker } from '../../types';
import { CapabilityTitle } from '@/lib/presentation';

interface Props {
  data: TopTalker[];
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

function formatConnectedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return `${Math.floor(diffH / 24)}d`;
}

export function TopTalkersTile({ data, span, onExpand, expandable }: Props) {
  const top = data.slice(0, 3);
  return (
    <Tile
      title={<CapabilityTitle capability="network" suffix="Connected Clients" />}
      sub="recent"
      span={span}
      onExpand={onExpand}
      expandable={expandable}
    >
      <div className="list">
        {top.map((t) => (
          <div key={`${t.name}-${t.ip}`} className="li">
            <span className="d" />
            <span className="name">{t.name}</span>
            <span className="val">{formatConnectedAt(t.connectedAt)}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
