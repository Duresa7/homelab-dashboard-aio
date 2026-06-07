import type { ReactNode } from 'react';
import { Container, Cpu, HardDrive, Network as NetworkIcon, Server, Zap } from 'lucide-react';

import { renderTile } from '../components/widgets';
import { Sparkline } from '../components/charts';
import {
  EntityCard,
  ListCard,
  ListRow,
  SummaryBar,
  type EntityMeta,
  type EntityMetric,
  type StatTone,
  type StatusKind,
  type SummaryStat,
} from '@/components/common';
import { batterySeverity, cpuUsageSeverity, fillSeverity, ramUsageSeverity } from '../lib/severity';
import { usePresentation, type PresentationMap } from '@/lib/presentation';
import type { Section } from '../lib/route';
import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
  setRoute: (section: Section) => void;
}

type Health = 'ok' | 'warn' | 'bad' | 'idle';
const RANK: Record<Health, number> = { idle: 0, ok: 1, warn: 2, bad: 3 };
const worst = (a: Health, b: Health): Health => (RANK[b] > RANK[a] ? b : a);

interface Subsystem {
  key: string;
  name: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  status: Health;
  statusLabel: string;
  section?: Section;
  metrics?: EntityMetric[];
  meta?: EntityMeta[];
  children?: ReactNode;
}

/** Build the per-subsystem summary cards from live state, gated by enabled capabilities. */
function buildSubsystems(data: DashboardState, p: PresentationMap): Subsystem[] {
  const out: Subsystem[] = [];

  if (p.datacenter.enabled) {
    const c = data.proxmox.cluster;
    const status: Health =
      c.nodesTotal === 0
        ? 'idle'
        : c.nodesOnline === 0
          ? 'bad'
          : c.nodesOnline < c.nodesTotal
            ? 'warn'
            : 'ok';
    out.push({
      key: 'datacenter',
      name: p.datacenter.label,
      subtitle: `${c.nodesOnline}/${c.nodesTotal} nodes online`,
      icon: <Server />,
      status,
      statusLabel: status === 'ok' ? 'healthy' : status === 'idle' ? 'no data' : 'degraded',
      section: 'proxmox',
      metrics: [
        { key: 'cpu', label: 'CPU', pct: c.cpuPct, tone: cpuUsageSeverity(c.cpuPct) },
        { key: 'ram', label: 'RAM', pct: c.memPct, tone: ramUsageSeverity(c.memPct) },
      ],
      meta: [
        { key: 'guests', value: `${c.guestsRunning}/${c.guestsTotal} guests` },
        {
          key: 'storage',
          value: `${c.storageUsedTB.toFixed(1)}/${c.storageTotalTB.toFixed(1)} TB`,
        },
      ],
    });
  }

  if (p.network.enabled) {
    const u = data.unifi;
    const hasGw = !!u.gateway.model && u.gateway.model !== '—';
    out.push({
      key: 'network',
      name: p.network.label,
      subtitle: hasGw ? u.gateway.model : undefined,
      icon: <NetworkIcon />,
      status: hasGw ? 'ok' : 'idle',
      statusLabel: hasGw ? 'online' : 'no data',
      section: 'network',
      meta: [
        { key: 'clients', value: `${u.clients} clients` },
        { key: 'wan', value: `↓ ${u.wan.down.toFixed(0)} · ↑ ${u.wan.up.toFixed(0)} Mbps` },
      ],
      children:
        data.network.downHistory.length > 1 ? (
          <Sparkline data={data.network.downHistory} height={30} color="var(--info)" />
        ) : undefined,
    });
  }

  if (p.containers.enabled) {
    const d = data.docker;
    const status: Health = d.total === 0 ? 'idle' : 'ok';
    out.push({
      key: 'containers',
      name: p.containers.label,
      subtitle: `${d.hosts.length} host${d.hosts.length === 1 ? '' : 's'}`,
      icon: <Container />,
      status,
      statusLabel: status === 'idle' ? 'no data' : 'running',
      section: 'docker',
      meta: [
        { key: 'running', value: `${d.running}/${d.total} running` },
        { key: 'updates', value: d.updates > 0 ? `${d.updates} updates` : 'up to date' },
      ],
    });
  }

  if (p.nas.enabled) {
    const pools = data.unas.pools;
    const status: Health = pools.some((pool) => /degraded|offline|error/i.test(pool.status))
      ? 'bad'
      : pools.length === 0
        ? 'idle'
        : 'ok';
    const fill = pools.reduce(
      (m, pool) => Math.max(m, pool.totalTB > 0 ? (pool.usedTB / pool.totalTB) * 100 : 0),
      0,
    );
    out.push({
      key: 'nas',
      name: p.nas.label,
      subtitle: data.unas.model && data.unas.model !== '—' ? data.unas.model : undefined,
      icon: <HardDrive />,
      status,
      statusLabel: status === 'ok' ? 'healthy' : status === 'idle' ? 'no data' : 'degraded',
      section: 'nas',
      metrics:
        pools.length > 0
          ? [{ key: 'fill', label: 'Used', pct: fill, tone: fillSeverity(fill) }]
          : undefined,
      meta: [
        { key: 'pools', value: `${pools.length} pool${pools.length === 1 ? '' : 's'}` },
        { key: 'disks', value: `${data.unas.disks.length} disks` },
      ],
    });
  }

  if (p.gpu.enabled && data.gpu.model && data.gpu.model !== '—') {
    const g = data.gpu;
    out.push({
      key: 'gpu',
      name: 'GPU',
      subtitle: g.model,
      icon: <Cpu />,
      status: 'ok',
      statusLabel: 'active',
      metrics: [{ key: 'usage', label: 'GPU', pct: g.usage }],
      meta: [
        { key: 'temp', value: `${Math.round(g.tempC)}°C` },
        { key: 'power', value: `${Math.round(g.powerW)} W` },
      ],
    });
  }

  const ups = data.ups;
  if (ups.status && ups.status !== '—') {
    const onBattery = /battery|discharg/i.test(ups.status);
    const status: Health = onBattery
      ? 'warn'
      : ups.batteryPct > 0 && ups.batteryPct < 25
        ? 'bad'
        : 'ok';
    out.push({
      key: 'power',
      name: 'Power',
      subtitle: ups.model && ups.model !== '—' ? ups.model : undefined,
      icon: <Zap />,
      status,
      statusLabel: ups.status,
      metrics: [
        { key: 'batt', label: 'Batt', pct: ups.batteryPct, tone: batterySeverity(ups.batteryPct) },
        { key: 'load', label: 'Load', pct: ups.loadPct },
      ],
      meta: [
        { key: 'runtime', value: `${ups.runtimeMin}m runtime` },
        { key: 'load', value: `${ups.loadW} W` },
      ],
    });
  }

  return out;
}

const HEALTH_TONE: Record<Health, StatTone> = {
  ok: 'ok',
  warn: 'warn',
  bad: 'bad',
  idle: 'default',
};

export function OverviewPage({ data, setRoute }: Props) {
  const presentation = usePresentation();
  const subsystems = buildSubsystems(data, presentation);

  const alerts = data.alerts;
  const alertTone: StatTone = alerts.some((a) => a.kind === 'bad')
    ? 'bad'
    : alerts.length > 0
      ? 'warn'
      : 'ok';

  const overall = subsystems.reduce<Health>(
    (acc, s) => worst(acc, s.status),
    alerts.some((a) => a.kind === 'bad') ? 'bad' : alerts.length > 0 ? 'warn' : 'ok',
  );
  const overallLabel =
    overall === 'bad' ? 'Critical' : overall === 'warn' ? 'Attention' : 'Operational';

  const healthStats: SummaryStat[] = [
    { key: 'status', label: 'Status', value: overallLabel, tone: HEALTH_TONE[overall] },
    {
      key: 'alerts',
      label: 'Active alerts',
      value: alerts.length,
      sub: alerts.length ? 'needs attention' : 'all clear',
      tone: alertTone,
    },
    ...subsystems
      .filter((s) => s.section)
      .slice(0, 3)
      .map<SummaryStat>((s) => ({
        key: s.key,
        label: s.name,
        value: s.statusLabel,
        tone: HEALTH_TONE[s.status],
      })),
  ];

  const recent = data.events.slice(0, 8);

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SummaryBar stats={healthStats} />

      <SectionLabel>Systems</SectionLabel>
      {subsystems.map((s) => (
        <EntityCard
          key={s.key}
          span={4}
          name={s.name}
          subtitle={s.subtitle}
          icon={s.icon}
          status={s.status}
          statusLabel={s.statusLabel}
          metrics={s.metrics}
          meta={s.meta}
          onClick={s.section ? () => setRoute(s.section as Section) : undefined}
        >
          {s.children}
        </EntityCard>
      ))}

      <SectionLabel>Apps</SectionLabel>
      {renderTile({ id: 'bookmarks', span: 12, data, expandable: false })}

      <ListCard
        span={12}
        title="Recent activity"
        sub={data.events.length}
        isEmpty={recent.length === 0}
        empty="No recent events"
      >
        {recent.map((e, i) => (
          <ListRow
            key={i}
            dot={e.kind as StatusKind}
            name={e.title}
            meta={e.body}
            value={<span className="font-mono text-[var(--ink-4)]">{e.ts}</span>}
          />
        ))}
      </ListCard>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="col-span-12 -mb-1 mt-2 flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </div>
  );
}
