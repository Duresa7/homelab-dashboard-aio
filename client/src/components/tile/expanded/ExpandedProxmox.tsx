import type { DashboardState } from '../../../types';

export function ExpandedProxmox({ data }: { data: DashboardState }) {
  const { node, vms, coresAllocated, coresTotal, storages } = data.proxmox;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Node · {node.name}</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {node.cpu.toFixed(0)}
              <small>%</small>
            </div>
            <div className="t-sub">CPU</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {node.ram.toFixed(0)}
              <small>%</small>
            </div>
            <div className="t-sub">RAM</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {coresAllocated}
              <small>/ {coresTotal}</small>
            </div>
            <div className="t-sub">cores allocated</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 22 }}>
              {node.uptime}
            </div>
            <div className="t-sub">uptime</div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">VMs ({vms.length})</div>
        <div className="list">
          {vms.map((v) => (
            <div key={v.id} className="li">
              <span className={`d ${v.state === 'running' ? '' : 'idle'}`} />
              <span className="name">{v.name}</span>
              <span className="meta">{v.type}</span>
              <span className="val">{v.cpu.toFixed(0)}% CPU</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Storages</div>
        <div className="list">
          {storages.map((s) => (
            <div key={s.name} className="li">
              <span className={`d ${s.active ? '' : 'warn'}`} />
              <span className="name">{s.name}</span>
              <span className="meta">{s.type}</span>
              <span className="val">
                {s.usedTB.toFixed(1)} / {s.totalTB.toFixed(1)} TB
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
