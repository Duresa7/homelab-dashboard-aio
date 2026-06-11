import { useState } from 'react';
import { Play, Square, Server, Layers, Container as ContainerIcon } from 'lucide-react';
import {
  EntityCard,
  SectionCard,
  StatCard,
  StatusBadge,
  Segmented,
  SubTabs,
} from '@/components/common';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import type { DashboardState } from '../types';
import { PresentationIcon, useCapabilityPresentation } from '@/lib/presentation';

interface Props {
  data: DashboardState;
  sub: string;
  onSelectSub: (sub: string) => void;
}

const DOCKER_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'hosts', label: 'Hosts' },
  { id: 'containers', label: 'Containers' },
];

function ContainersBrandIcon({ size = 18 }: { size?: number }) {
  const containers = useCapabilityPresentation('containers');
  return (
    <PresentationIcon
      capability="containers"
      icon={containers.icon}
      label={containers.vendorLabel ?? containers.label}
      size={size}
    />
  );
}

function DataSourceNotice() {
  const containers = useCapabilityPresentation('containers');
  const viaPortainer = containers.providerId === 'portainer';
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <ContainersBrandIcon size={14} />
      <span>
        Data source: <span className="font-medium text-foreground">{containers.vendorLabel}</span>
        {viaPortainer ? (
          <>
            {' '}
            — container data is fetched through the Portainer API, a third-party application. Native
            Docker and Kubernetes support is planned.
          </>
        ) : null}
      </span>
    </div>
  );
}

function Overview({ data }: { data: DashboardState }) {
  const c = data.docker.containers;
  const hosts = data.docker.hosts;
  const stacks = [...new Set(c.map((x) => x.stack))];
  const running = c.filter((x) => x.state === 'running').length;
  const stopped = c.length - running;
  const hostsOffline = hosts.filter((h) => h.status !== 'online').length;

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <StatCard
        span={3}
        tone="ok"
        icon={<Play strokeWidth={1.75} />}
        label="Running"
        value={running}
        hint={`of ${c.length} containers`}
      />
      <StatCard
        span={3}
        tone={stopped > 0 ? 'warn' : 'default'}
        icon={<Square strokeWidth={1.75} />}
        label="Stopped"
        value={stopped}
      />
      <StatCard
        span={3}
        tone={hostsOffline > 0 ? 'bad' : 'default'}
        icon={<Server strokeWidth={1.75} />}
        label="Hosts"
        value={hosts.length}
        hint={hostsOffline > 0 ? `${hostsOffline} offline` : 'all online'}
      />
      <StatCard
        span={3}
        icon={<Layers strokeWidth={1.75} />}
        label="Stacks"
        value={stacks.length}
      />

      <SectionCard
        span={12}
        title="Host status"
        sub={hosts.length}
        icon={<ContainersBrandIcon size={16} />}
        bodyClassName="flex flex-col gap-2"
      >
        {hosts.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No Docker hosts detected
          </div>
        ) : (
          hosts.map((h) => {
            const list = c.filter((x) => x.host === h.id);
            const up = list.filter((x) => x.state === 'running').length;
            const hostOk = h.status === 'online';
            return (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                  <StatusBadge kind={hostOk ? 'ok' : 'bad'}>
                    {hostOk ? 'online' : 'offline'}
                  </StatusBadge>
                  <span className="truncate">{h.name}</span>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {up}/{list.length} containers · cpu {h.cpu.toFixed(0)}% · ram {h.ram.toFixed(0)}%
                </span>
              </div>
            );
          })
        )}
      </SectionCard>
    </div>
  );
}

function Hosts({ data }: { data: DashboardState }) {
  const c = data.docker.containers;
  const hosts = data.docker.hosts;

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <div className="col-span-12 -mb-1 flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <ContainersBrandIcon size={14} /> Container hosts · {hosts.length}
      </div>
      {hosts.length === 0 ? (
        <SectionCard span={12} bodyClassName="py-8 text-center text-sm text-muted-foreground">
          No Docker hosts detected
        </SectionCard>
      ) : (
        hosts.map((h) => {
          const list = c.filter((x) => x.host === h.id);
          const up = list.filter((x) => x.state === 'running').length;
          const hostOk = h.status === 'online';
          return (
            <EntityCard
              key={h.id}
              span={4}
              name={h.name}
              subtitle={`${h.os} · engine ${h.engine}`}
              icon={<ContainerIcon />}
              status={hostOk ? 'ok' : 'bad'}
              statusLabel={hostOk ? 'online' : 'offline'}
              metrics={[
                { key: 'cpu', label: 'CPU', pct: h.cpu },
                { key: 'ram', label: 'RAM', pct: h.ram },
              ]}
              meta={[
                { key: 'containers', value: `${up}/${list.length} containers` },
                { key: 'addr', value: h.addr },
              ]}
            />
          );
        })
      )}
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
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SectionCard span={12} title="Filter" sub={`${filtered.length} containers`}>
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">host</span>
            <Segmented
              value={hostFilter}
              onChange={setHostFilter}
              options={[
                { value: 'all', label: 'all' },
                ...hosts.map((h) => ({ value: h.id, label: h.name })),
              ]}
            />
          </div>
          {allStacks.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">stack</span>
              <Segmented
                value={stackFilter}
                onChange={setStackFilter}
                options={[
                  { value: 'all', label: 'all' },
                  ...allStacks.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          )}
        </div>
      </SectionCard>

      {visibleHosts.flatMap((h) => {
        const hostCs = filtered.filter((x) => x.host === h.id);
        if (hostCs.length === 0) return [];
        const hostStacks = [...new Set(hostCs.map((x) => x.stack))];
        return hostStacks.map((s) => {
          const list = hostCs.filter((x) => x.stack === s);
          return (
            <SectionCard
              key={`${h.id}/${s}`}
              span={6}
              icon={<ContainersBrandIcon size={16} />}
              title={
                <span className="flex items-center gap-1.5">
                  {h.name} <span className="text-muted-foreground/50">/</span> {s}
                </span>
              }
              sub={`${list.length} containers`}
              bodyClassName="flex flex-col gap-2"
            >
              {list.map((x) => {
                const dot =
                  x.state === 'stopped' ? 'bg-idle' : x.state === 'paused' ? 'bg-warn' : 'bg-ok';
                const kind = x.state === 'stopped' ? 'idle' : x.state === 'paused' ? 'warn' : 'ok';
                return (
                  <HoverCard key={x.name} openDelay={140} closeDelay={80}>
                    <HoverCardTrigger asChild>
                      <div className="flex cursor-default flex-col gap-0.5 rounded-lg border border-border p-3 transition-colors hover:border-border/80 hover:bg-muted/40">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <span className={cn('size-1.5 shrink-0 rounded-full', dot)} />
                          <span className="truncate">{x.name}</span>
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {x.image}
                        </div>
                        <div className="text-xs tabular-nums text-muted-foreground">
                          cpu {x.cpu.toFixed(1)}% · {x.memMB} MB
                        </div>
                        <div className="text-xs tabular-nums text-muted-foreground/70">
                          up {x.uptime}
                        </div>
                      </div>
                    </HoverCardTrigger>
                    <HoverCardContent side="top" align="start" className="w-72">
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {x.name}
                          </span>
                          <StatusBadge kind={kind}>{x.state}</StatusBadge>
                        </div>
                        <div>
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Image
                          </span>
                          <p className="break-all font-mono text-xs text-foreground">{x.image}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">CPU</div>
                            <div className="tabular-nums text-foreground">{x.cpu.toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Memory</div>
                            <div className="tabular-nums text-foreground">{x.memMB} MB</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Uptime</div>
                            <div className="tabular-nums text-foreground">{x.uptime}</div>
                          </div>
                        </div>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                );
              })}
            </SectionCard>
          );
        });
      })}

      {filtered.length === 0 && (
        <SectionCard span={12}>
          <div className="py-10 text-center text-sm text-muted-foreground">
            No containers match the current filters
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export function DockerPage({ data, sub, onSelectSub }: Props) {
  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <SubTabs tabs={DOCKER_TABS} active={sub} onChange={onSelectSub} />
      <DataSourceNotice />
      {sub === 'containers' ? (
        <Containers data={data} />
      ) : sub === 'hosts' ? (
        <Hosts data={data} />
      ) : (
        <Overview data={data} />
      )}
    </div>
  );
}
