import { useState } from 'react';
import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
}

export function DockerPage({ data }: Props) {
  const c = data.docker.containers;
  const hosts = data.docker.hosts;
  const [hostFilter, setHostFilter] = useState<string>('all');
  const filtered = hostFilter === 'all' ? c : c.filter((x) => x.host === hostFilter);
  const stacks = [...new Set(filtered.map((x) => x.stack))];
  const visibleHosts = hosts.filter((h) => hostFilter === 'all' || hostFilter === h.id);
  return (
    <div className="grid">
      <div className="tile span-3">
        <div className="t-title">Running</div>
        <div className="t-big" style={{ color: 'var(--ok)' }}>
          {filtered.filter((x) => x.state === 'running').length}
        </div>
      </div>
      <div className="tile span-3">
        <div className="t-title">Stopped</div>
        <div className="t-big" style={{ color: 'var(--warn)' }}>
          {filtered.filter((x) => x.state !== 'running').length}
        </div>
      </div>
      <div className="tile span-3">
        <div className="t-title">Hosts</div>
        <div className="t-big">{hosts.length}</div>
        <div className="t-sub">{hosts.map((h) => h.name).join(' · ')}</div>
      </div>
      <div className="tile span-3">
        <div className="t-title">Stacks</div>
        <div className="t-big">{stacks.length}</div>
        <div className="t-sub">{stacks.join(', ')}</div>
      </div>

      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">Docker hosts</div>
          <div className="chart-pick">
            <button
              className={hostFilter === 'all' ? 'is-on' : ''}
              onClick={() => setHostFilter('all')}
              style={{ width: 'auto', padding: '0 10px', fontSize: 11 }}
            >
              all
            </button>
            {hosts.map((h) => (
              <button
                key={h.id}
                className={hostFilter === h.id ? 'is-on' : ''}
                onClick={() => setHostFilter(h.id)}
                style={{ width: 'auto', padding: '0 10px', fontSize: 11 }}
              >
                {h.name}
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(hosts.length, 1)}, 1fr)`,
            gap: 12,
          }}
        >
          {hosts.map((h) => {
            const list = c.filter((x) => x.host === h.id);
            const up = list.filter((x) => x.state === 'running').length;
            return (
              <div
                key={h.id}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 12,
                  background: 'var(--surface-2)',
                }}
              >
                <div className="between">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    <span
                      style={{
                        width: 7, height: 7, borderRadius: 50,
                        background: 'var(--ok)', display: 'inline-block', marginRight: 6,
                      }}
                    />
                    {h.name}
                  </div>
                  <div className="t-sub mono">{h.addr}</div>
                </div>
                <div className="t-sub mono" style={{ fontSize: 10.5 }}>
                  {h.os} · engine {h.engine}
                </div>
                <dl className="kv" style={{ marginTop: 8 }}>
                  <dt>Containers</dt><dd>{up}/{list.length}</dd>
                  <dt>CPU</dt><dd>{h.cpu}%</dd>
                  <dt>RAM</dt><dd>{h.ram}%</dd>
                </dl>
              </div>
            );
          })}
        </div>
      </div>

      {visibleHosts.flatMap((h) => {
        const hostCs = filtered.filter((x) => x.host === h.id);
        const hostStacks = [...new Set(hostCs.map((x) => x.stack))];
        return hostStacks.map((s) => {
          const list = hostCs.filter((x) => x.stack === s);
          return (
            <div key={`${h.id}/${s}`} className="tile span-6">
              <div className="t-head">
                <div className="t-title">
                  {h.name} <span style={{ color: 'var(--ink-4)' }}>·</span> stack {s}
                </div>
                <div className="t-sub">{list.length} containers</div>
              </div>
              <div className="containers" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                {list.map((x) => (
                  <div key={x.name} className="container-card">
                    <div className="name">
                      <span className={`d ${x.state === 'stopped' ? 'idle' : ''}`} />
                      {x.name}
                    </div>
                    <div className="image">{x.image}</div>
                    <div className="meta">cpu {x.cpu.toFixed(1)}% · {x.memMB} MB</div>
                    <div className="meta" style={{ color: 'var(--ink-4)' }}>up {x.uptime}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        });
      })}
    </div>
  );
}
