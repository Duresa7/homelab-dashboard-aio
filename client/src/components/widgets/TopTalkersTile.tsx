import { Tile } from '../tile/Tile';
import type { TopTalker } from '../../types';
import { CapabilityTitle } from '@/lib/presentation';

interface Props {
  data: TopTalker[];
  span?: number;
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

export function TopTalkersTile({ data, span }: Props) {
  const top = data.slice(0, 3);
  return (
    <Tile
      title={<CapabilityTitle capability="network" suffix="Connected Clients" />}
      sub="recent"
      span={span}
    >
      <div className="flex flex-col">
        {top.map((t) => (
          <div
            key={`${t.name}-${t.ip}`}
            className="grid grid-cols-[14px_1fr_auto] items-center gap-3 -mx-2 rounded-lg border-b border-border px-2 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--bg-2)]"
          >
            <span className="size-2 rounded-full bg-ok" />
            <span className="truncate text-[15.5px] font-medium text-foreground">{t.name}</span>
            <span className="text-[14.5px] font-medium tabular-nums text-[var(--ink-2)]">
              {formatConnectedAt(t.connectedAt)}
            </span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
