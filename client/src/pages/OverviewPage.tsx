import { useSyncExternalStore, type ReactNode } from 'react';
import {
  Check,
  CircleSlash,
  Container,
  Cpu,
  HardDrive,
  Network as NetworkIcon,
  Server,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getState, setState, subscribe as subscribeState } from '@/lib/store';
import { BookmarksTile } from '../components/widgets';
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
import { capList, useListRows } from '@/lib/list-rows';
import type { Section } from '../lib/route';
import type { DashboardState, ProxmoxClusterNode } from '../types';

interface Props {
  data: DashboardState;
  setRoute: (section: Section, sub?: string) => void;
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

  sub?: string;

  noData?: boolean;
  metrics?: EntityMetric[];
  meta?: EntityMeta[];
  children?: ReactNode;
}

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
      noData: status === 'idle',
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
      noData: !hasGw,
      meta: [
        { key: 'clients', value: `${u.clients} clients` },
        { key: 'wan', value: `↓ ${u.wan.down.toFixed(0)} · ↑ ${u.wan.up.toFixed(0)} Mbps` },
      ],
      children:
        hasGw && data.network.downHistory.length > 1 ? (
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
      noData: status === 'idle',
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
      noData: status === 'idle',
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
      section: 'proxmox',
      sub: 'sensors',
      metrics: [{ key: 'usage', label: 'GPU', pct: g.usage }],
      meta: [
        { key: 'temp', value: `${Math.round(g.tempC)}°C` },
        { key: 'power', value: `${Math.round(g.powerW)} W` },
      ],
      children:
        g.history.length > 1 ? (
          <Sparkline data={g.history} height={30} color="var(--accent)" />
        ) : undefined,
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
      section: 'proxmox',
      sub: 'sensors',
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
  const listRows = useListRows();
  const subsystems = buildSubsystems(data, presentation);

  const allNodes = data.proxmox.nodes.map((n) => n.name);
  const storedSelection = useStoreValue<string[] | null>(SELECTED_NODES_KEY, null);
  const selectedNames =
    storedSelection == null ? allNodes : allNodes.filter((n) => storedSelection.includes(n));
  const selectedSet = new Set(selectedNames);
  const showNodes = allNodes.length > 1;
  const visibleNodes = data.proxmox.nodes.filter((n) => selectedSet.has(n.name));
  const toggleNode = (name: string) => {
    const base =
      storedSelection == null ? allNodes : allNodes.filter((n) => storedSelection.includes(n));
    const next = new Set(base);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setState(
      SELECTED_NODES_KEY,
      allNodes.filter((n) => next.has(n)),
    );
  };

  const alerts = data.alerts;
  const alertTone: StatTone = alerts.some((a) => a.kind === 'bad')
    ? 'bad'
    : alerts.length > 0
      ? 'warn'
      : 'ok';

  const badCount = alerts.filter((a) => a.kind === 'bad').length;
  const warnCount = alerts.filter((a) => a.kind === 'warn').length;
  const alertBreakdown = [
    badCount ? `${badCount} critical` : null,
    warnCount ? `${warnCount} warning` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const newestAge = alerts[0]?.ago;
  const alertSub = alerts.length
    ? [alertBreakdown || 'needs attention', newestAge].filter(Boolean).join(' · ')
    : 'all clear';

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
      sub: alertSub,
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

  const recent = capList(data.events, listRows);

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
          metrics={s.noData ? undefined : s.metrics}
          meta={s.noData ? undefined : s.meta}
          onClick={s.section ? () => setRoute(s.section as Section, s.sub) : undefined}
        >
          {s.noData ? <CardEmpty /> : s.children}
        </EntityCard>
      ))}

      {showNodes ? (
        <>
          <SectionLabel>Nodes</SectionLabel>
          <NodeSelector nodes={allNodes} selected={selectedSet} onToggle={toggleNode} />
          {visibleNodes.length === 0 ? (
            <div className="col-span-12 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              No nodes selected.
            </div>
          ) : (
            visibleNodes.map((node) => (
              <NodeCard
                key={node.name}
                node={node}
                data={data}
                onClick={() => setRoute('proxmox')}
              />
            ))
          )}
        </>
      ) : null}

      <SectionLabel>Apps</SectionLabel>
      <BookmarksTile span={12} />

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

function CardEmpty() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
      <CircleSlash className="size-3.5 shrink-0" />
      No data reported
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

const SELECTED_NODES_KEY = 'overviewSelectedNodes';

function useStoreValue<T>(key: string, fallback: T): T {
  return useSyncExternalStore(
    (fn) => subscribeState(key, fn),
    () => getState<T>(key, fallback),
    () => getState<T>(key, fallback),
  );
}

function NodeSelector({
  nodes,
  selected,
  onToggle,
}: {
  nodes: string[];
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  return (
    <div className="col-span-12 -mt-1 flex flex-wrap gap-2">
      {nodes.map((name) => {
        const on = selected.has(name);
        return (
          <Button
            key={name}
            type="button"
            size="sm"
            variant={on ? 'default' : 'outline'}
            aria-pressed={on}
            onClick={() => onToggle(name)}
          >
            {on ? <Check className="size-3.5" /> : null}
            {name}
          </Button>
        );
      })}
    </div>
  );
}

function NodeCard({
  node,
  data,
  onClick,
}: {
  node: ProxmoxClusterNode;
  data: DashboardState;
  onClick: () => void;
}) {
  const gpus = data.gpus.filter((g) => g.node === node.name);
  const sensors = data.sensorNodes.find((s) => s.node === node.name);
  const unreachable =
    data.gpuUnavailable.some((u) => u.node === node.name) ||
    data.sensorsUnavailable.some((u) => u.node === node.name);

  const online = node.status ? node.status === 'online' : true;
  const status: Health = !online ? 'bad' : unreachable ? 'warn' : 'ok';
  const statusLabel = !online ? node.status || 'offline' : unreachable ? 'partial' : 'online';

  const metrics: EntityMetric[] = [
    { key: 'cpu', label: 'CPU', pct: node.cpu, tone: cpuUsageSeverity(node.cpu) },
    { key: 'ram', label: 'RAM', pct: node.ram, tone: ramUsageSeverity(node.ram) },
    { key: 'disk', label: 'Disk', pct: node.disk, tone: fillSeverity(node.disk) },
  ];

  const primaryGpu = gpus[0];
  const more = gpus.length > 1 ? ` (+${gpus.length - 1})` : '';
  const gpuMeta = primaryGpu
    ? primaryGpu.metricsAvailable === false
      ? `${primaryGpu.model}${primaryGpu.integrated ? ' (iGPU)' : ''}${more}`
      : `GPU ${Math.round(primaryGpu.usage)}% · ${Math.round(primaryGpu.tempC)}°C${more}`
    : 'No GPU';
  const tempMeta =
    sensors && typeof sensors.cpuTempC === 'number'
      ? `CPU ${Math.round(sensors.cpuTempC)}°C`
      : sensors
        ? 'No CPU temp'
        : 'No sensors';

  return (
    <EntityCard
      span={4}
      name={node.name}
      subtitle={primaryGpu ? primaryGpu.model : undefined}
      icon={<Server />}
      status={status}
      statusLabel={statusLabel}
      metrics={metrics}
      meta={[
        { key: 'gpu', value: gpuMeta },
        { key: 'temp', value: tempMeta },
      ]}
      onClick={onClick}
    />
  );
}
