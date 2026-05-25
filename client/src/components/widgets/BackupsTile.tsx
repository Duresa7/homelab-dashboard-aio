import { Tile } from '../tile/Tile';
import type { Backup } from '../../types';

interface Props {
  data: Backup[];
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function BackupsTile({ data, span, onExpand, expandable }: Props) {
  const total = data.length;
  const failing = data.filter((b) => b.status === 'bad').length;
  const warning = data.filter((b) => b.status === 'warn').length;
  const ok = total - failing - warning;
  const latest = data[0];
  const tagKind = failing ? 'bad' : warning ? 'warn' : 'ok';
  const tagLabel = failing ? `${failing} failed` : warning ? `${warning} warning` : 'all ok';
  return (
    <Tile
      title="Backups"
      sub={`${total} jobs`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: tagLabel, kind: tagKind }}
    >
      <div className="t-big">
        {ok}
        <small> / {total} ok</small>
      </div>
      <div className="t-sub">{latest ? `last run ${latest.when}` : 'no jobs configured'}</div>
    </Tile>
  );
}
