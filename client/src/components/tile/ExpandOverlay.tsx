import type { CSSProperties } from 'react';
import { AreaChart, Donut } from '../charts';
import { ALL_TILES, renderTile, tileData, type TileId } from '../widgets/registry';
import { CameraSnapshot } from '../widgets/CameraSnapshot';
import { TempHeatTile } from '../widgets/TempHeatTile';
import type { ChartKind, CPUData, DashboardState, GPUData } from '../../types';
import { fmtTemp, useTempUnit, convertTemp, tempSuffix } from '../../lib/units';
import { formatPowerOnTime } from '../../lib/format';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  cpuTempSeverity,
  cpuUsageSeverity,
  gpuTempSeverity,
  fanSeverity,
  diskTempSeverity,
  fillSeverity,
  batterySeverity,
  pingSeverity,
  uptimeSeverity,
} from '../../lib/severity';

interface TempHeatData {
  cpu: CPUData;
  gpu: GPUData;
  disks: { name: string; tempC: number }[];
}

interface Props {
  id: TileId | null;
  data: DashboardState;
  chartKind: ChartKind;
  setChartKind: (k: ChartKind) => void;
  onClose: () => void;
}

export function ExpandOverlay({ id, data, chartKind, setChartKind, onClose }: Props) {
  const def = id ? ALL_TILES.find((t) => t.id === id) : null;

  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="grid max-h-[88vh] w-[min(1100px,92vw)] max-w-[min(1100px,92vw)] grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 sm:max-w-[min(1100px,92vw)]">
        {id ? (
          <>
            <DialogHeader className="border-b border-border px-6 py-4 text-left">
              <DialogTitle className="font-display text-lg tracking-tight">
                {def ? def.label : id}
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto px-6 py-5">
              <ExpandedBody id={id} data={data} chartKind={chartKind} setChartKind={setChartKind} />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ExpandedBody({ id, data, chartKind, setChartKind }: Omit<Props, 'onClose'>) {
  if (!id) return null;
  const { unit } = useTempUnit();
  const td = tileData(id, data);

  switch (id) {
    case 'cpu':
      return <ExpandedCPU data={data} />;
    case 'ram':
      return <ExpandedRAM data={data} />;
    case 'gpu':
      return <ExpandedGPU data={data} unit={unit} />;
    case 'smart':
      return <ExpandedSmart data={data} unit={unit} />;
    case 'ups':
      return <ExpandedUPS data={data} />;
    case 'docker':
      return <ExpandedDocker data={data} />;
    case 'storage':
      return <ExpandedStorage data={data} />;
    case 'unas':
      return <ExpandedUnas data={data} unit={unit} />;
    case 'backups':
      return <ExpandedBackups data={data} />;
    case 'internet':
      return <ExpandedInternet data={data} />;
    case 'unifi':
      return <ExpandedUnifi data={data} />;
    case 'network':
      return <ExpandedNetwork data={data} />;
    case 'topTalkers':
      return <ExpandedTopTalkers data={data} />;
    case 'proxmox':
      return <ExpandedProxmox data={data} />;
    case 'protect':
      return <ExpandedProtect data={data} />;
    case 'fans':
      return <ExpandedFans data={data} />;
    case 'events':
      return <ExpandedEvents data={data} />;
    case 'tempHeat': {
      const { cpu, gpu, disks } = td as TempHeatData;
      return <TempHeatTile cpu={cpu} gpu={gpu} disks={disks} span={12} expandable={false} />;
    }
    default:
      return (
        <>
          {renderTile({
            id,
            span: 12,
            data: td,
            chartKind,
            onChartKind: setChartKind,
            expandable: false,
          })}
        </>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Per-tile expanded views                                            */
/* ------------------------------------------------------------------ */

function ExpandedCPU({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const cpu = data.cpu;
  const usageKind = cpuUsageSeverity(cpu.usage);
  const tempKind = cpuTempSeverity(cpu.tempC);
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">CPU</div>
          <div className="t-sub">{cpu.model}</div>
        </div>
        <div className="metric-row">
          <Donut
            value={cpu.usage}
            label={`${cpu.usage.toFixed(0)}%`}
            sub="usage"
            kind={usageKind}
          />
          <div className="meta flex1">
            <div className="v">
              <b>{((cpu.usage / 100) * cpu.cores).toFixed(1)}</b>
              <span style={{ color: 'var(--ink-3)' }}> / {cpu.cores} cores busy · </span>
              <b className={`text-${tempKind}`}>{fmtTemp(cpu.tempC, unit)}</b>
            </div>
          </div>
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">All cores · live</div>
        <div className="cores" style={{ gridTemplateColumns: 'repeat(16, 1fr)' }}>
          {cpu.coreList.map((c) => {
            const cls = c.pct > 85 ? 'bad' : c.pct > 65 ? 'warn' : '';
            return (
              <div
                key={c.id}
                className={`core ${cls}`}
                style={{ '--p': `${c.pct.toFixed(0)}%`, height: 36 } as CSSProperties}
              >
                <span>{c.pct.toFixed(0)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Usage history</div>
        <AreaChart data={cpu.history} height={140} />
      </div>
      <div className="tile span-6">
        <div className="t-title">Temperature history</div>
        <AreaChart data={cpu.tempHistory} height={140} color="var(--warn)" />
      </div>
    </div>
  );
}

function ExpandedRAM({ data }: { data: DashboardState }) {
  const ram = data.ram;
  const pct = (ram.usedGB / ram.totalGB) * 100;
  const freeGB = ram.totalGB - ram.usedGB;
  return (
    <div className="ov-grid">
      <div className="tile span-6">
        <div className="t-title">Memory</div>
        <div className="metric-row">
          <Donut value={pct} label={`${pct.toFixed(0)}%`} sub="used" />
          <div className="meta flex1">
            <div className="v">
              <b>{ram.usedGB.toFixed(1)}</b>
              <span style={{ color: 'var(--ink-3)' }}> / {ram.totalGB} GB</span>
            </div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Breakdown</div>
        <dl className="kv">
          <dt>Used</dt>
          <dd>{ram.usedGB.toFixed(2)} GB</dd>
          <dt>Cached</dt>
          <dd>{ram.cachedGB.toFixed(2)} GB</dd>
          <dt>Free</dt>
          <dd>{freeGB.toFixed(2)} GB</dd>
          <dt>Total</dt>
          <dd>{ram.totalGB} GB</dd>
        </dl>
      </div>
      <div className="tile span-12">
        <div className="t-title">Usage history</div>
        <AreaChart data={ram.history} height={160} />
      </div>
    </div>
  );
}

function ExpandedGPU({ data, unit }: { data: DashboardState; unit: 'C' | 'F' }) {
  const gpu = data.gpu;
  const tempKind = gpuTempSeverity(gpu.tempC);
  const fanKind = fanSeverity(gpu.fanPct);
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">GPU</div>
          <div className="t-sub">{gpu.model}</div>
        </div>
        <div className="metric-row">
          <Donut value={gpu.usage} label={`${gpu.usage.toFixed(0)}%`} sub="gpu" />
          <div className="meta flex1">
            <div className="v">
              <b>{gpu.memUsedGB.toFixed(1)}</b>
              <span style={{ color: 'var(--ink-3)' }}> / {gpu.memTotalGB} GB VRAM</span>
            </div>
          </div>
        </div>
        <dl className="kv">
          <dt>Power</dt>
          <dd>
            {gpu.powerW.toFixed(0)} / {gpu.powerMaxW} W
          </dd>
          <dt>Fan</dt>
          <dd className={`text-${fanKind}`}>{gpu.fanPct.toFixed(0)}%</dd>
          <dt>Temp</dt>
          <dd className={`text-${tempKind}`}>{fmtTemp(gpu.tempC, unit)}</dd>
          <dt>GPU clock</dt>
          <dd>{gpu.gpuClockMHz} MHz</dd>
          <dt>Mem clock</dt>
          <dd>{gpu.memClockMHz} MHz</dd>
        </dl>
      </div>
      <div className="tile span-12">
        <div className="t-title">Usage history</div>
        <AreaChart data={gpu.history} height={160} />
      </div>
    </div>
  );
}

function ExpandedSmart({ data, unit }: { data: DashboardState; unit: 'C' | 'F' }) {
  const disks = data.storage.disks;
  const ok = disks.filter((d) => d.smart === 'ok').length;
  const warn = disks.filter((d) => d.smart === 'warn').length;
  const bad = disks.filter((d) => d.smart === 'bad').length;
  const avgC = disks.length ? disks.reduce((a, b) => a + b.tempC, 0) / disks.length : 0;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Summary</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className="t-big text-ok" style={{ fontSize: 32 }}>
              {ok}
            </div>
            <div className="t-sub">healthy</div>
          </div>
          <div>
            <div className="t-big text-warn" style={{ fontSize: 32 }}>
              {warn}
            </div>
            <div className="t-sub">warning</div>
          </div>
          <div>
            <div className="t-big text-bad" style={{ fontSize: 32 }}>
              {bad}
            </div>
            <div className="t-sub">failing</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 32 }}>
              {Math.round(convertTemp(avgC, unit))}
              <small>{tempSuffix(unit)}</small>
            </div>
            <div className="t-sub">avg temp</div>
          </div>
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">All drives</div>
        <div className="list">
          {disks.map((d) => (
            <div key={d.name} className="li">
              <span
                className={`d ${d.smart === 'bad' ? 'bad' : d.smart === 'warn' ? 'warn' : ''}`}
              />
              <span className="name">{d.name}</span>
              <span className="meta">{d.model}</span>
              <span className="val">
                <span className={`text-${diskTempSeverity(d.tempC)}`}>
                  {fmtTemp(d.tempC, unit)}
                </span>
                <span style={{ color: 'var(--ink-3)', marginLeft: 8 }}>
                  · {formatPowerOnTime(d.ageHours)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExpandedUPS({ data }: { data: DashboardState }) {
  const ups = data.ups;
  const batteryKind = batterySeverity(ups.batteryPct);
  return (
    <div className="ov-grid">
      <div className="tile span-6">
        <div className="t-title">Battery</div>
        <div className="metric-row">
          <Donut
            value={ups.batteryPct}
            label={`${ups.batteryPct}%`}
            sub="battery"
            kind={batteryKind}
          />
          <div className="meta flex1">
            <div className="v">
              <b>{ups.runtimeMin}</b>
              <span style={{ color: 'var(--ink-3)' }}> min runtime</span>
            </div>
            <div className="lbl">status · {ups.status}</div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Load</div>
        <div className="t-big">
          {ups.loadW}
          <small> W</small>
        </div>
        <div className="t-sub">{ups.loadPct}% of rated capacity</div>
        <div className="pbar" style={{ marginTop: 8 }}>
          <span style={{ width: `${ups.loadPct}%` }} />
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Model</dt>
          <dd>{ups.model}</dd>
        </dl>
      </div>
    </div>
  );
}

function ExpandedDocker({ data }: { data: DashboardState }) {
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

function ExpandedStorage({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Pools</div>
        <div className="disks">
          {data.storage.pools.map((p) => {
            const pct = p.totalTB > 0 ? (p.usedTB / p.totalTB) * 100 : 0;
            const fillKind = p.status === 'degraded' ? 'bad' : fillSeverity(pct);
            const cls = fillKind === 'ok' ? '' : fillKind;
            return (
              <div key={p.name} className="disk">
                <div className="row">
                  <div
                    className="name flex1"
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 50,
                        background: p.status === 'degraded' ? 'var(--bad)' : 'var(--ok)',
                      }}
                    />
                    {p.name}
                    <span className="t-tag" style={{ marginLeft: 4 }}>
                      {p.type}
                    </span>
                  </div>
                  <div className="meta">
                    <span className={`text-${fillKind}`}>{p.usedTB.toFixed(2)}</span> /{' '}
                    {p.totalTB.toFixed(2)} TB
                  </div>
                </div>
                <div className={`pbar ${cls}`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExpandedUnas({ data, unit }: { data: DashboardState; unit: 'C' | 'F' }) {
  const { pools, disks } = data.unas;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Pools</div>
        <div className="disks">
          {pools.map((p) => {
            const pct = p.totalTB > 0 ? (p.usedTB / p.totalTB) * 100 : 0;
            const cls = p.status === 'offline' ? 'bad' : p.status === 'degraded' ? 'warn' : 'ok';
            return (
              <div key={p.name} className="disk">
                <div className="row">
                  <div
                    className="name flex1"
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 50,
                        background:
                          cls === 'ok'
                            ? 'var(--ok)'
                            : cls === 'warn'
                              ? 'var(--warn)'
                              : 'var(--bad)',
                      }}
                    />
                    {p.name}
                    <span className="t-tag">{p.type}</span>
                  </div>
                  <div className="meta">
                    {p.usedTB.toFixed(2)} / {p.totalTB.toFixed(2)} TB
                  </div>
                </div>
                <div className={`pbar ${cls === 'ok' ? '' : cls}`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Drives</div>
        <div className="list">
          {disks.map((d) => (
            <div key={d.slot} className="li">
              <span
                className={`d ${d.smart === 'bad' ? 'bad' : d.smart === 'warn' ? 'warn' : ''}`}
              />
              <span className="name">
                Slot {d.slot} · {d.model}
              </span>
              <span className="meta">{formatPowerOnTime(d.powerOnHours)}</span>
              <span className="val">{fmtTemp(d.tempC, unit)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExpandedBackups({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">All jobs</div>
        <div className="list">
          {data.backups.map((b) => (
            <div key={b.name} className="li">
              <span
                className={`d ${b.status === 'warn' ? 'warn' : b.status === 'bad' ? 'bad' : ''}`}
              />
              <span className="name">{b.name}</span>
              <span className="meta">{b.when}</span>
              <span className="val">{b.sizeGB} GB</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExpandedInternet({ data }: { data: DashboardState }) {
  const n = data.network;
  const uptimeKind = uptimeSeverity(n.uptime30d);
  const pingKind = pingSeverity(n.speedtest.ping);
  return (
    <div className="ov-grid">
      <div className="tile span-6">
        <div className="t-title">Connectivity</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className={`t-big text-${uptimeKind}`}>
              {n.uptime30d.toFixed(2)}
              <small>%</small>
            </div>
            <div className="t-sub">uptime · 30d</div>
          </div>
          <div>
            <div className={`t-big text-${pingKind}`}>
              {n.speedtest.ping}
              <small>ms</small>
            </div>
            <div className="t-sub">ping</div>
          </div>
        </div>
        <dl className="kv" style={{ marginTop: 16 }}>
          <dt>Public IP</dt>
          <dd>{n.publicIp}</dd>
          <dt>Down / Up</dt>
          <dd>
            {n.speedtest.down} / {n.speedtest.up} Mbps
          </dd>
          <dt>Last speedtest</dt>
          <dd>{n.speedtest.when}</dd>
        </dl>
      </div>
      <div className="tile span-6">
        <div className="t-title">DNS resolvers</div>
        <div className="list">
          {n.dns.map((d) => (
            <div key={d.ip} className="li">
              <span className="d" />
              <span className="name">{d.name}</span>
              <span className="meta">{d.ip}</span>
              <span className="val">{d.status}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Latency history</div>
        <AreaChart data={n.latencyHistory} height={140} />
      </div>
    </div>
  );
}

function ExpandedUnifi({ data }: { data: DashboardState }) {
  const { gateway, clients, clientBreakdown, wan, switches, aps } = data.unifi;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Gateway · {gateway.model}</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {gateway.cpu.toFixed(0)}
              <small>%</small>
            </div>
            <div className="t-sub">CPU</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {gateway.ram.toFixed(0)}
              <small>%</small>
            </div>
            <div className="t-sub">RAM</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 22 }}>
              {gateway.uptime}
            </div>
            <div className="t-sub">uptime</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {clients}
            </div>
            <div className="t-sub">clients</div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">WAN</div>
        <div className="netrate">
          <div className="col">
            <div className="label">↓ down</div>
            <div className="v">
              {wan.down}
              <small>Mbps</small>
            </div>
            <div className="pbar">
              <span style={{ width: `${(wan.down / wan.downMax) * 100}%` }} />
            </div>
          </div>
          <div className="col">
            <div className="label">↑ up</div>
            <div className="v">
              {wan.up}
              <small>Mbps</small>
            </div>
            <div className="pbar">
              <span style={{ width: `${(wan.up / wan.upMax) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
      <div className="tile span-6">
        <div className="t-title">Client breakdown</div>
        <dl className="kv">
          <dt>Wireless</dt>
          <dd>{clientBreakdown.wireless}</dd>
          <dt>Wired</dt>
          <dd>{clientBreakdown.wired}</dd>
          {clientBreakdown.vpn > 0 ? (
            <>
              <dt>VPN</dt>
              <dd>{clientBreakdown.vpn}</dd>
            </>
          ) : null}
        </dl>
      </div>
      {switches.length > 0 ? (
        <div className="tile span-6">
          <div className="t-title">Switches</div>
          <div className="list">
            {switches.map((s) => (
              <div key={s.name} className="li">
                <span className={`d ${s.state === 'connected' ? '' : 'warn'}`} />
                <span className="name">{s.name}</span>
                <span className="meta">{s.model}</span>
                <span className="val">
                  {s.portsActive}/{s.ports} ports
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {aps.length > 0 ? (
        <div className="tile span-6">
          <div className="t-title">Access points</div>
          <div className="list">
            {aps.map((ap) => (
              <div key={ap.name} className="li">
                <span className={`d ${ap.state === 'connected' ? '' : 'warn'}`} />
                <span className="name">{ap.name}</span>
                <span className="meta">{ap.channel}</span>
                <span className="val">{ap.clients} clients</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExpandedNetwork({ data }: { data: DashboardState }) {
  const n = data.network;
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Throughput</div>
        <div className="netrate">
          <div className="col">
            <div className="label">↓ download</div>
            <div className="v">
              {n.downHistory[n.downHistory.length - 1].toFixed(0)}
              <small>Mbps</small>
            </div>
            <AreaChart data={n.downHistory} height={80} />
          </div>
          <div className="col">
            <div className="label">↑ upload</div>
            <div className="v">
              {n.upHistory[n.upHistory.length - 1].toFixed(0)}
              <small>Mbps</small>
            </div>
            <AreaChart data={n.upHistory} height={80} />
          </div>
        </div>
      </div>
      <div className="tile span-12">
        <div className="t-title">Metrics</div>
        <dl className="kv">
          <dt>Latency</dt>
          <dd>{n.latencyMs.toFixed(1)} ms</dd>
          <dt>Last speedtest</dt>
          <dd>
            {n.speedtest.down}/{n.speedtest.up} Mbps · ping {n.speedtest.ping} ms
          </dd>
          <dt>Uptime 30d</dt>
          <dd>{n.uptime30d.toFixed(2)}%</dd>
          <dt>Public IP</dt>
          <dd>{n.publicIp}</dd>
        </dl>
      </div>
    </div>
  );
}

function ExpandedTopTalkers({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">All connected clients</div>
        <div className="list">
          {data.unifi.topTalkers.map((t) => (
            <div key={`${t.name}-${t.ip}`} className="li">
              <span className="d" />
              <span className="name">{t.name}</span>
              <span className="meta">
                {t.ip} · {t.type.toLowerCase()}
              </span>
              <span className="val">
                ↓{t.rxMB.toFixed(0)} ↑{t.txMB.toFixed(0)} MB
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExpandedProxmox({ data }: { data: DashboardState }) {
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

function ExpandedProtect({ data }: { data: DashboardState }) {
  const { cameras, total, connected, disconnected, recentEvents } = data.protect;
  const connectedCams = cameras.filter((c) => c.state === 'CONNECTED');
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">Summary</div>
        <div className="row" style={{ gap: 32, paddingTop: 4 }}>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {connected}
            </div>
            <div className="t-sub">online</div>
          </div>
          <div>
            <div className={`t-big ${disconnected ? 'text-warn' : ''}`} style={{ fontSize: 28 }}>
              {disconnected}
            </div>
            <div className="t-sub">offline</div>
          </div>
          <div>
            <div className="t-big" style={{ fontSize: 28 }}>
              {total}
            </div>
            <div className="t-sub">total</div>
          </div>
        </div>
      </div>
      {connectedCams.length > 0 ? (
        <div className="tile span-12">
          <div className="t-title">Live preview</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 8,
              paddingTop: 8,
            }}
          >
            {connectedCams.map((cam) => (
              <CameraSnapshot key={cam.id} camera={cam} intervalMs={4000} />
            ))}
          </div>
        </div>
      ) : null}
      {recentEvents.length > 0 ? (
        <div className="tile span-12">
          <div className="t-title">Recent events</div>
          <div className="list">
            {recentEvents.slice(0, 12).map((ev) => (
              <div key={ev.id} className="li">
                <span className="d" />
                <span className="name">{ev.type}</span>
                <span className="meta">{ev.smartDetectTypes.join(', ') || ev.device}</span>
                <span className="val">{new Date(ev.start).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExpandedFans({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">All fans</div>
        <div className="col" style={{ gap: 8 }}>
          {data.fans.map((f) => {
            // Guard against missing/zero max so an unknown rated speed
            // doesn't render as Infinity% width or fake a critical band.
            const hasRated = Number.isFinite(f.max) && f.max > 0;
            const pct = hasRated ? (f.rpm / f.max) * 100 : 0;
            const kind = hasRated ? fanSeverity(pct) : 'info';
            const cls = kind === 'ok' ? '' : kind;
            return (
              <div key={f.name} className="disk">
                <div className="row">
                  <div className="name flex1">{f.name}</div>
                  <div className="meta">
                    <span className={`text-${kind}`}>{f.rpm.toFixed(0)}</span>
                    <span style={{ color: 'var(--ink-4)' }}> rpm</span>
                    <span style={{ color: 'var(--ink-3)', marginLeft: 8 }}>
                      · {pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className={`pbar ${cls}`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExpandedEvents({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">All events ({data.events.length})</div>
        <div className="events" style={{ maxHeight: 'none' }}>
          {data.events.map((e, i) => (
            <div key={i} className="ev">
              <span className="ts">{e.ts}</span>
              <span className={`d ${e.kind}`} />
              <div className="body">
                <b>{e.title}</b>
                <span>{e.body}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
