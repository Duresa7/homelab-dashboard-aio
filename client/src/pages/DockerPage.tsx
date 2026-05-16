import { useState } from 'react';
import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
  sub: string;
}

function Hosts({ data }: { data: DashboardState }) {
  const c = data.docker.containers;
  const hosts = data.docker.hosts;
  const stacks = [...new Set(c.map((x) => x.stack))];
  const running = c.filter((x) => x.state === 'running').length;
  const stopped = c.length - running;
  return (
    <div className="grid">
      <div className="tile span-3">
        <div className="t-title">Running</div>
        <div className="t-big" style={{ color: 'var(--ok)' }}>{running}</div>
        <div className="t-sub">of {c.length} containers</div>
      </div>
      <div className="tile span-3">
        <div className="t-title">Stopped</div>
        <div className="t-big" style={{ color: stopped > 0 ? 'var(--warn)' : 'var(--ink-3)' }}>{stopped}</div>
        <div className="t-sub">{stopped === 0 ? 'all healthy' : 'not running'}</div>
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
        <div className="t-title">Docker hosts</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(Math.max(hosts.length, 1), 3)}, 1fr)`,
            gap: 12,
            marginTop: 8,
          }}
        >
          {hosts.map((h) => {
            const list = c.filter((x) => x.host === h.id);
            const up = list.filter((x) => x.state === 'running').length;
            const hostOk = h.status === 'online';
            return (
              <div
                key={h.id}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius)',
                  padding: 14,
                  background: 'var(--surface-2)',
                }}
              >
                <div className="between">
                  <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`status-dot ${hostOk ? 'ok' : 'bad'}`} />
                    {h.name}
                  </div>
                  <span className={`pill ${hostOk ? 'ok' : 'bad'}`}>
                    <span className="dot" />
                    {hostOk ? 'online' : 'offline'}
                  </span>
                </div>
                <div className="t-sub" style={{ marginTop: 4 }}>
                  {h.addr} · {h.os} · engine {h.engine}
                </div>
                <dl className="kv" style={{ marginTop: 12 }}>
                  <dt>Containers</dt><dd>{up}/{list.length}</dd>
                  <dt>CPU</dt><dd>{h.cpu}%</dd>
                  <dt>RAM</dt><dd>{h.ram}%</dd>
                </dl>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Containers({ data }: { data: DashboardState }) {
  const c = data.docker.containers;
  const hosts = data.docker.hosts;
  const [hostFilter, setHostFilter] = useState<string>('all');
  const [stackFilter, setStackFilter] = useState<string>('all');

  const allStacks = [...new Set(c.map((x) => x.stack))];

  let filtered = c;
  if (hostFilter !== 'all') filtered = filtered.filter((x) => x.host === hostFilter);
  if (stackFilter !== 'all') filtered = filtered.filter((x) => x.stack === stackFilter);

  const visibleHosts = hosts.filter((h) => hostFilter === 'all' || hostFilter === h.id);

  return (
    <div className="grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">Filter</div>
          <div className="t-sub">{filtered.length} containers</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="t-sub" style={{ fontFamily: 'var(--font-sans)' }}>host</div>
            <div className="chart-pick">
              <button
                className={hostFilter === 'all' ? 'is-on' : ''}
                onClick={() => setHostFilter('all')}
                style={{ width: 'auto', padding: '0 12px', fontSize: 12 }}
              >
                all
              </button>
              {hosts.map((h) => (
                <button
                  key={h.id}
                  className={hostFilter === h.id ? 'is-on' : ''}
                  onClick={() => setHostFilter(h.id)}
                  style={{ width: 'auto', padding: '0 12px', fontSize: 12 }}
                >
                  {h.name}
                </button>
              ))}
            </div>
          </div>
          {allStacks.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="t-sub" style={{ fontFamily: 'var(--font-sans)' }}>stack</div>
              <div className="chart-pick">
                <button
                  className={stackFilter === 'all' ? 'is-on' : ''}
                  onClick={() => setStackFilter('all')}
                  style={{ width: 'auto', padding: '0 12px', fontSize: 12 }}
                >
                  all
                </button>
                {allStacks.map((s) => (
                  <button
                    key={s}
                    className={stackFilter === s ? 'is-on' : ''}
                    onClick={() => setStackFilter(s)}
                    style={{ width: 'auto', padding: '0 12px', fontSize: 12 }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {visibleHosts.flatMap((h) => {
        const hostCs = filtered.filter((x) => x.host === h.id);
        if (hostCs.length === 0) return [];
        const hostStacks = [...new Set(hostCs.map((x) => x.stack))];
        return hostStacks.map((s) => {
          const list = hostCs.filter((x) => x.stack === s);
          return (
            <div key={`${h.id}/${s}`} className="tile span-6">
              <div className="t-head">
                <div className="t-title">
                  {h.name} <span style={{ color: 'var(--ink-4)' }}>/</span> {s}
                </div>
                <div className="t-sub">{list.length} containers</div>
              </div>
              <div className="containers">
                {list.map((x) => (
                  <div key={x.name} className="container-card">
                    <div className="name">
                      <span className={`d ${x.state === 'stopped' ? 'idle' : x.state === 'paused' ? 'warn' : ''}`} />
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

      {filtered.length === 0 && (
        <div className="tile span-12">
          <div className="page-empty">No containers match the current filters</div>
        </div>
      )}
    </div>
  );
}

export function DockerPage({ data, sub }: Props) {
  if (sub === 'containers') return <Containers data={data} />;
  return <Hosts data={data} />;
}
