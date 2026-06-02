import { Tile } from '../tile/Tile';
import type { DockerData } from '../../types';

interface Props {
  data: DockerData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function DockerTile({ data, span, onExpand, expandable }: Props) {
  const { hosts, running, stopped, total, updates } = data;
  return (
    <Tile
      title="Docker"
      sub={`${hosts.length} host${hosts.length === 1 ? '' : 's'}`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: stopped ? `${stopped} stopped` : 'all up', kind: stopped ? 'warn' : 'ok' }}
    >
      <div className="t-big">
        {running}
        <small> / {total} running</small>
      </div>
      <div className="t-sub">
        {updates > 0 ? (
          <>
            <b className="text-info">{updates}</b> update{updates === 1 ? '' : 's'} available
          </>
        ) : (
          'all images current'
        )}
      </div>
    </Tile>
  );
}
