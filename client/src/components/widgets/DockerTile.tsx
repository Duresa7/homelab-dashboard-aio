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
          <div className="t-big" style={{ fontSize: 24 }}>{running}</div>
          <div className="t-sub">running</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 24, color: stopped ? 'var(--warn)' : '' }}>
            {stopped}
          </div>
          <div className="t-sub">stopped</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 24 }}>{updates}</div>
          <div className="t-sub">updates</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 24 }}>{hosts.length}</div>
          <div className="t-sub">hosts</div>
        </div>
      </div>
      {hosts.map((h) => {
        const list = containers.filter((c) => c.host === h.id);
        const up = list.filter((c) => c.state === 'running').length;
        const hostOk = h.status === 'online';
        return (
          <div key={h.id} className="col" style={{ gap: 6, paddingTop: 6 }}>
            <div className="between">
              <div className="t-title" style={{ fontSize: 11 }}>
                <span
                  style={{
                    width: 6, height: 6, borderRadius: 50,
                    background: hostOk ? 'var(--ok)' : 'var(--bad)', display: 'inline-block', marginRight: 6,
                  }}
                />
                {h.name}
                <span className="t-tag" style={{ marginLeft: 6 }}>{h.addr}</span>
              </div>
              <div className="t-sub">
                {hostOk ? `${up}/${list.length} up · cpu ${h.cpu}% · ram ${h.ram}%` : 'offline'}
              </div>
            </div>
            <div className="containers" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {list.map((c) => (
                <div key={c.name} className="container-card">
                  <div className="name">
                    <span
                      className={`d ${c.state === 'stopped' ? 'idle' : c.state === 'paused' ? 'warn' : ''}`}
                    />
                    {c.name}
                  </div>
                  <div className="image" title={c.image}>{c.image.split('/').slice(-1)[0]}</div>
                  <div className="meta">cpu {c.cpu.toFixed(1)}% · {c.memMB} MB</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </Tile>
  );
}
