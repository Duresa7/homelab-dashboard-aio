import { CPUTile, RAMTile } from '../components/widgets';
import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
}

export function ProxmoxPage({ data }: Props) {
  return (
    <div className="grid">
      <div className="tile span-4">
        <div className="t-title">Node</div>
        <div className="t-big">{data.proxmox.node.name}</div>
        <dl className="kv">
          <dt>Version</dt><dd>{data.proxmox.node.version}</dd>
          <dt>Uptime</dt><dd>{data.proxmox.node.uptime}</dd>
          <dt>CPU</dt><dd>{data.proxmox.node.cpu.toFixed(0)}%</dd>
          <dt>RAM</dt><dd>{data.proxmox.node.ram.toFixed(0)}%</dd>
          <dt>Cores</dt><dd>{data.proxmox.coresAllocated}/{data.proxmox.coresTotal}</dd>
        </dl>
      </div>
      <CPUTile data={data.cpu} span={4} chartKind="area" expandable={false} />
      <RAMTile data={data.ram} span={4} chartKind="area" expandable={false} />
      <div className="tile span-12">
        <div className="t-title">VMs &amp; LXCs</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>State</th>
              <th>ID</th>
              <th>Name</th>
              <th>Type</th>
              <th className="num">CPU</th>
              <th className="num">RAM</th>
              <th className="num">Disk</th>
            </tr>
          </thead>
          <tbody>
            {data.proxmox.vms.map((v) => {
              const cls = v.state === 'stopped' ? 'idle' : v.state === 'paused' ? 'warn' : '';
              const dotColor =
                cls === 'idle' ? 'var(--ink-4)' : cls === 'warn' ? 'var(--warn)' : 'var(--ok)';
              return (
                <tr key={v.id}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{ width: 7, height: 7, borderRadius: 50, background: dotColor }}
                      />
                      {v.state}
                    </span>
                  </td>
                  <td className="mono">{v.id}</td>
                  <td>{v.name}</td>
                  <td className="muted">{v.type}</td>
                  <td className="mono tnum num">{v.cpu.toFixed(1)}%</td>
                  <td className="mono tnum num">{v.ram}%</td>
                  <td className="mono tnum num">{v.disk} GB</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
