import { Tile } from '../tile/Tile';
import type { DockerData } from '../../types';

interface Props {
  data: DockerData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function DockerTile({ data, span, onExpand, expandable }: Props) {
  const { containers, hosts, running, stopped, total, updates } = data;
  return (
    <Tile
      title="Docker"
      sub={`${total} containers · ${hosts.length} hosts`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: `${running} up · ${stopped} down`, kind: stopped ? 'warn' : 'ok' }}
    >
      <div className="row" style={{ gap: 14, paddingBottom: 6, borderBottom: '1px dashed var(--line)' }}>
        <div>
          <div className="t-big" style={{ fontSize: 28 }}>{running}</div>
          <div className="t-sub">running</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 28, color: stopped ? 'var(--warn)' : '' }}>
            {stopped}
          </div>
          <div className="t-sub">stopped</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 28 }}>{updates}</div>
          <div className="t-sub">updates</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 28 }}>{hosts.length}</div>
          <div className="t-sub">hosts</div>
        </div>
      </div>
      <div className="list">
        {hosts.map((h) => {
          const list = containers.filter((c) => c.host === h.id);
          const up = list.filter((c) => c.state === 'running').length;
          const hostOk = h.status === 'online';
          return (
            <div key={h.id} className="li">
              <span className={`d ${hostOk ? '' : 'bad'}`} />
              <span className="name">{h.name}</span>
              <span className="meta">{h.addr}</span>
              <span className="val">
                {hostOk ? `${up}/${list.length} up` : 'offline'}
              </span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}
