import type { DashboardState } from '../../../types';

export function ExpandedDocker({ data }: { data: DashboardState }) {
  const { hosts, containers, running, stopped, total, updates } = data.docker;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Summary</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className="t-big" style={{ fontSize: 30 }}>
              {running}
            </div>
            <div className="t-sub">running</div>
          </div>
          <div>
            <div className={`t-big ${stopped ? 'text-warn' : ''}`} style={{ fontSize: 30 }}>
              {stopped}
            </div>
            <div className="t-sub">stopped</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 30 }}>
              {updates}
            </div>
            <div className="t-sub">updates</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 30 }}>
              {hosts.length}
            </div>
            <div className="t-sub">hosts</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 30 }}>
              {total}
            </div>
            <div className="t-sub">total</div>
          </div>
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Hosts</div>
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
                <span className="val">{hostOk ? `${up}/${list.length} up` : 'offline'}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Containers</div>
        <div className="containers">
          {containers.map((c) => (
            <div key={`${c.host}-${c.name}`} className="container-card">
              <div className="name">
                <span
                  className={`d ${c.state === 'running' ? '' : c.state === 'paused' ? 'warn' : 'bad'}`}
                />
                {c.name}
              </div>
              <div className="image">{c.image}</div>
              <div className="meta">
                <span>{c.cpu.toFixed(1)}% CPU</span>
                <span>{c.memMB} MB</span>
                <span>{c.uptime}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
