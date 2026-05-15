import { Tile } from '../tile/Tile';
import type { TopTalker } from '../../types';

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
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function typeLabel(type: string): string {
  switch (type) {
    case 'WIRELESS': return '📶';
    case 'WIRED': return '🔌';
    case 'VPN': return '🔒';
    case 'TELEPORT': return '🌐';
    default: return '•';
  }
}

export function TopTalkersTile({ data, span, onExpand, expandable }: Props) {
  return (
    <Tile title="Connected Clients" sub="recent" span={span} onExpand={onExpand} expandable={expandable}>
      <div className="list">
        {data.map((t) => (
          <div key={`${t.name}-${t.ip}`} className="li">
            <span className="d" />
            <span className="name">{typeLabel(t.type)} {t.name}{t.access === 'GUEST' ? ' 👤' : ''}</span>
            <span className="meta">{t.ip}</span>
            <span className="val">{formatConnectedAt(t.connectedAt)}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
