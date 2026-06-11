import type { ReactNode } from 'react';
import { AreaChart, Sparkline } from '../components/charts';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Wifi,
  Cable,
  Globe,
  Shield,
  Lock,
  Router,
} from 'lucide-react';
import { TopTalkersTile } from '../components/widgets';
import { BrandIcon, vpnBrand } from '../components/icons/BrandIcon';
import {
  DataTableCard,
  SectionCard,
  StatCard,
  StatList,
  StatRow,
  StatusBadge,
  SubTabs,
} from '@/components/common';
import { Button } from '@/components/ui/button';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { DashboardState } from '../types';
import { fmtTemp, useTempUnit } from '../lib/units';
import { PresentationIcon, useCapabilityPresentation } from '@/lib/presentation';

interface Props {
  data: DashboardState;
  sub: string;
  onSelectSub: (sub: string) => void;
}

const NET_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'devices', label: 'Devices' },
  { id: 'clients', label: 'Clients' },
  { id: 'config', label: 'Config' },
  { id: 'firewall', label: 'Firewall' },
];

function NetworkBrandIcon({ size = 18 }: { size?: number }) {
  const network = useCapabilityPresentation('network');
  return (
    <PresentationIcon
      capability="network"
      icon={network.icon}
      label={network.vendorLabel ?? network.label}
      size={size}
    />
  );
}

type DotKind = 'ok' | 'bad' | 'idle';

function RateStat({
  dir,
  value,
  history,
  color,
}: {
  dir: 'down' | 'up';
  value: number;
  history: number[];
  color: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {dir === 'down' ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
        {dir === 'down' ? 'Download' : 'Upload'}
      </span>
      <span className="flex items-baseline gap-1">
        <span className="font-display text-3xl leading-none font-semibold tabular-nums text-foreground">
          {value.toFixed(0)}
        </span>
        <span className="text-sm font-medium text-muted-foreground">Mbps</span>
      </span>
      <div className="mt-1">
        <Sparkline data={history} height={28} color={color} />
      </div>
    </div>
  );
}

function Overview({ data }: { data: DashboardState }) {
  const u = data.unifi;
  const net = data.network;
  const { unit } = useTempUnit();
  const lh = net.latencyHistory;
  const cpuPct = u.gateway.cpu;
  const ramPct = u.gateway.ram;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SectionCard
        span={4}
        title="Gateway"
        icon={
          <span className="flex items-center gap-1.5">
            <NetworkBrandIcon />
            <Router size={14} strokeWidth={1.75} />
          </span>
        }
      >
        <div className="mb-3 text-xl font-semibold tracking-tight text-foreground">
          {u.gateway.model}
        </div>
        <StatList>
          <StatRow label="Firmware" value={u.gateway.fwVersion} />
          <StatRow label="Uptime" value={u.gateway.uptime} />
          <StatRow label="CPU" value={`${cpuPct.toFixed(0)}%`} />
          <StatRow label="RAM" value={`${ramPct.toFixed(0)}%`} />
          <StatRow label="Temp" value={fmtTemp(u.gateway.tempC, unit)} />
          <StatRow label="Public IP" value={u.wan.public} />
          {u.appVersion ? <StatRow label="App Version" value={u.appVersion} /> : null}
        </StatList>
      </SectionCard>

      <SectionCard
        span={8}
        title="WAN Throughput"
        icon={<Activity size={14} strokeWidth={1.75} />}
        sub={`${u.clients} clients`}
      >
        <div className="flex flex-wrap gap-8">
          <RateStat dir="down" value={u.wan.down} history={net.downHistory} color="var(--info)" />
          <RateStat dir="up" value={u.wan.up} history={net.upHistory} color="var(--accent)" />
        </div>
      </SectionCard>

      <SectionCard span={4} title="Internet" icon={<Globe size={14} strokeWidth={1.75} />}>
        <StatList>
          <StatRow label="Speedtest ↓" value={`${net.speedtest.down.toFixed(0)} Mbps`} />
          <StatRow label="Speedtest ↑" value={`${net.speedtest.up.toFixed(0)} Mbps`} />
          <StatRow label="Ping" value={`${net.speedtest.ping.toFixed(0)} ms`} />
          <StatRow label="30-day uptime" value={`${net.uptime30d.toFixed(2)}%`} />
          <StatRow label="Last run" value={net.speedtest.when} />
        </StatList>
      </SectionCard>

      <SectionCard
        span={8}
        title="Latency · last 60 ticks"
        icon={<Activity size={14} strokeWidth={1.75} />}
        actions={
          <span className="text-sm font-medium tabular-nums text-foreground">
            {net.latencyMs.toFixed(1)} ms
          </span>
        }
      >
        <AreaChart data={lh} height={120} formatValue={(v) => `${v.toFixed(1)} ms`} showBounds />
        <div className="mt-2 flex gap-6 text-xs text-muted-foreground tabular-nums">
          <span>min {lh.length ? Math.min(...lh).toFixed(1) : '—'} ms</span>
          <span>max {lh.length ? Math.max(...lh).toFixed(1) : '—'} ms</span>
        </div>
      </SectionCard>
    </div>
  );
}

function Devices({ data }: { data: DashboardState }) {
  const u = data.unifi;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <DataTableCard
        span={6}
        sub={u.aps.length}
        title="Wi-Fi Access Points"
        icon={
          <span className="flex items-center gap-1.5">
            <NetworkBrandIcon />
            <Wifi size={14} strokeWidth={1.75} />
          </span>
        }
        isEmpty={u.aps.length === 0}
        empty="No APs detected"
        head={
          <>
            <TableHead>Access Point</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead className="text-right">Clients</TableHead>
          </>
        }
      >
        {u.aps.map((ap) => (
          <TableRow key={ap.name}>
            <TableCell>
              <NameCell dot={ap.state === 'ONLINE' ? 'ok' : 'bad'}>{ap.name}</NameCell>
            </TableCell>
            <TableCell className="text-muted-foreground">{ap.model}</TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {ap.channel !== 'n/a' ? (
                <>
                  ch{ap.channel}
                  {ap.frequency ? ` · ${ap.frequency}GHz` : ''}
                </>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{ap.clients}</TableCell>
          </TableRow>
        ))}
      </DataTableCard>

      <SectionCard
        span={6}
        sub={u.switches.length}
        title="Switches & PoE"
        icon={
          <span className="flex items-center gap-1.5">
            <NetworkBrandIcon />
            <Cable size={14} strokeWidth={1.75} />
          </span>
        }
        bodyClassName="flex flex-col gap-3"
      >
        {u.switches.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No switches detected</div>
        ) : (
          u.switches.map((s) => {
            const pct = s.poeMaxW ? (s.poeUsedW / s.poeMaxW) * 100 : 0;
            return (
              <div key={s.name} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        s.state === 'ONLINE' ? 'bg-ok' : 'bg-bad',
                      )}
                    />
                    <span className="truncate">{s.name}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{s.model}</span>
                </div>
                {s.poeMaxW > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-9 shrink-0">PoE</span>
                    <Progress value={pct} className="h-1.5 flex-1 bg-muted" />
                    <span className="shrink-0 tabular-nums">
                      {s.poeUsedW}/{s.poeMaxW} W
                    </span>
                  </div>
                )}
                <div className="text-xs tabular-nums text-muted-foreground">
                  {s.portsUp}/{s.ports} ports up · {s.portsActive} clients
                </div>
              </div>
            );
          })
        )}
      </SectionCard>
    </div>
  );
}

function Clients({ data }: { data: DashboardState }) {
  const u = data.unifi;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <TopTalkersTile data={u.topTalkers} span={12} />
    </div>
  );
}

function NameCell({ dot, children }: { dot: DotKind; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          dot === 'ok' ? 'bg-ok' : dot === 'bad' ? 'bg-bad' : 'bg-idle',
        )}
      />
      <span className="truncate text-sm font-medium text-foreground">{children}</span>
    </span>
  );
}

function Config({ data, onOpenFirewall }: { data: DashboardState; onOpenFirewall: () => void }) {
  const u = data.unifi;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <DataTableCard
        span={6}
        sub={u.networks.length}
        title="Networks & VLANs"
        icon={<NetworkBrandIcon />}
        isEmpty={u.networks.length === 0}
        empty="No networks data"
        head={
          <>
            <TableHead>Network</TableHead>
            <TableHead>VLAN</TableHead>
            <TableHead>Management</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </>
        }
      >
        {u.networks.map((n) => (
          <TableRow key={n.id}>
            <TableCell>
              <NameCell dot={n.enabled ? 'ok' : 'idle'}>
                {n.name}
                {n.isDefault ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">default</span>
                ) : null}
              </NameCell>
            </TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {n.vlanId !== null ? n.vlanId : 'untagged'}
            </TableCell>
            <TableCell className="text-muted-foreground">{n.management}</TableCell>
            <TableCell className="text-right">
              <StatusBadge kind={n.enabled ? 'ok' : 'idle'}>
                {n.enabled ? 'enabled' : 'disabled'}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </DataTableCard>

      <DataTableCard
        span={6}
        sub={u.ssids.length}
        title="Wi-Fi SSIDs"
        icon={<NetworkBrandIcon />}
        isEmpty={u.ssids.length === 0}
        empty="No SSID data"
        head={
          <>
            <TableHead>SSID</TableHead>
            <TableHead>Security</TableHead>
            <TableHead>Bands</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </>
        }
      >
        {u.ssids.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <NameCell dot={s.enabled ? 'ok' : 'idle'}>{s.name}</NameCell>
            </TableCell>
            <TableCell className="text-muted-foreground">{s.security}</TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {s.broadcastingFrequencies.length > 0
                ? s.broadcastingFrequencies.map((f) => `${f}GHz`).join(', ')
                : '—'}
            </TableCell>
            <TableCell className="text-right">
              <StatusBadge kind={s.enabled ? 'ok' : 'idle'}>
                {s.enabled ? 'active' : 'disabled'}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </DataTableCard>

      <SectionCard
        span={4}
        title="Firewall"
        icon={
          <span className="flex items-center gap-1.5">
            <NetworkBrandIcon />
            <Shield size={14} strokeWidth={1.75} />
          </span>
        }
        actions={
          <Button variant="outline" size="sm" onClick={onOpenFirewall}>
            View policies
          </Button>
        }
      >
        <StatList>
          <StatRow label="Zones" value={u.firewall.zones} />
          <StatRow
            label="Policies"
            value={`${u.firewall.policiesEnabled}/${u.firewall.policies} enabled`}
          />
        </StatList>
      </SectionCard>

      <DataTableCard
        span={4}
        sub={u.vpnServers.length}
        title="VPN Servers"
        icon={<Lock size={14} strokeWidth={1.75} />}
        isEmpty={u.vpnServers.length === 0}
        empty="No VPN servers"
        head={
          <>
            <TableHead>Server</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </>
        }
      >
        {u.vpnServers.map((v) => {
          const brand = vpnBrand(v.type);
          return (
            <TableRow key={v.id}>
              <TableCell>
                <NameCell dot={v.enabled ? 'ok' : 'idle'}>{v.name}</NameCell>
              </TableCell>
              <TableCell className="text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {brand ? <BrandIcon name={brand} size={14} alt={v.type} /> : null}
                  {v.type}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <StatusBadge kind={v.enabled ? 'ok' : 'idle'}>
                  {v.enabled ? 'active' : 'disabled'}
                </StatusBadge>
              </TableCell>
            </TableRow>
          );
        })}
      </DataTableCard>

      <DataTableCard
        span={4}
        sub={u.dnsRecords.length}
        title="DNS Records"
        icon={
          <span className="flex items-center gap-1.5">
            <NetworkBrandIcon />
            <Globe size={14} strokeWidth={1.75} />
          </span>
        }
        isEmpty={u.dnsRecords.length === 0}
        empty="No local DNS records"
        head={
          <>
            <TableHead>Domain</TableHead>
            <TableHead className="text-right">Type</TableHead>
          </>
        }
      >
        {u.dnsRecords.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <NameCell dot={r.enabled ? 'ok' : 'idle'}>{r.domain}</NameCell>
            </TableCell>
            <TableCell className="text-right text-muted-foreground">{r.type}</TableCell>
          </TableRow>
        ))}
      </DataTableCard>
    </div>
  );
}

function Firewall({ data }: { data: DashboardState }) {
  const fw = data.unifi.firewall;
  const policies = [...fw.policyList].sort(
    (a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER),
  );
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <StatCard span={4} icon={<Shield strokeWidth={1.75} />} label="Zones" value={fw.zones} />
      <StatCard
        span={4}
        icon={<Shield strokeWidth={1.75} />}
        label="Policies"
        value={fw.policies}
      />
      <StatCard
        span={4}
        tone={fw.policiesEnabled < fw.policies ? 'warn' : 'default'}
        icon={<Activity strokeWidth={1.75} />}
        label="Enabled"
        value={`${fw.policiesEnabled}/${fw.policies}`}
        hint={fw.policies > 0 ? `${fw.policies - fw.policiesEnabled} disabled` : undefined}
      />

      <DataTableCard
        span={4}
        title="Zones"
        sub={fw.zoneList.length}
        icon={<Shield size={14} strokeWidth={1.75} />}
        isEmpty={fw.zoneList.length === 0}
        empty="No firewall zones reported"
        head={
          <>
            <TableHead>Zone</TableHead>
            <TableHead className="text-right">Networks</TableHead>
          </>
        }
      >
        {fw.zoneList.map((z) => (
          <TableRow key={z.id}>
            <TableCell className="font-medium text-foreground">{z.name}</TableCell>
            <TableCell className="text-right tabular-nums">{z.networkCount}</TableCell>
          </TableRow>
        ))}
      </DataTableCard>

      <DataTableCard
        span={8}
        title="Policies"
        sub={`${fw.policiesEnabled}/${fw.policies} enabled`}
        icon={<Shield size={14} strokeWidth={1.75} />}
        isEmpty={policies.length === 0}
        empty="No firewall policies reported"
        head={
          <>
            <TableHead>Policy</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Source → Destination</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </>
        }
      >
        {policies.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <NameCell dot={p.enabled ? 'ok' : 'idle'}>
                {p.name}
                {p.predefined ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    predefined
                  </span>
                ) : null}
              </NameCell>
            </TableCell>
            <TableCell>
              <StatusBadge
                kind={/block|deny|reject/i.test(String(p.action)) ? 'bad' : 'ok'}
                dot={false}
              >
                {String(p.action || 'unknown').toLowerCase()}
              </StatusBadge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {p.sourceZone} <span className="text-muted-foreground/50">→</span> {p.destinationZone}
            </TableCell>
            <TableCell className="text-right">
              <StatusBadge kind={p.enabled ? 'ok' : 'idle'}>
                {p.enabled ? 'enabled' : 'disabled'}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </DataTableCard>
    </div>
  );
}

export function NetworkPage({ data, sub, onSelectSub }: Props) {
  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <SubTabs tabs={NET_TABS} active={sub} onChange={onSelectSub} />
      {sub === 'devices' ? (
        <Devices data={data} />
      ) : sub === 'clients' ? (
        <Clients data={data} />
      ) : sub === 'config' ? (
        <Config data={data} onOpenFirewall={() => onSelectSub('firewall')} />
      ) : sub === 'firewall' ? (
        <Firewall data={data} />
      ) : (
        <Overview data={data} />
      )}
    </div>
  );
}
