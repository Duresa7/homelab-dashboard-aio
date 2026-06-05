import type { ReactNode } from 'react';
import { AreaChart } from '../components/charts';
import { Activity, Wifi, Cable, Globe, Shield, Lock, Router } from 'lucide-react';
import { InternetTile, NetworkTile, TopTalkersTile } from '../components/widgets';
import { BrandIcon, vpnBrand } from '../components/icons/BrandIcon';
import { SectionCard, StatList, StatRow } from '@/components/common';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { DashboardState } from '../types';
import { fmtTemp, useTempUnit } from '../lib/units';
import { PresentationIcon, useCapabilityPresentation } from '@/lib/presentation';

interface Props {
  data: DashboardState;
  sub: string;
}

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

/** One row in a config/device list — dot · name · meta · value. */
function ListRow({
  dot,
  name,
  meta,
  val,
}: {
  dot: DotKind;
  name: ReactNode;
  meta?: ReactNode;
  val?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 py-2 last:border-0">
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          dot === 'ok' ? 'bg-ok' : dot === 'bad' ? 'bg-bad' : 'bg-idle',
        )}
      />
      <span className="shrink-0 text-sm font-medium text-foreground">{name}</span>
      {meta != null ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {meta}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {val != null ? (
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{val}</span>
      ) : null}
    </div>
  );
}

function emptyRow(text: string) {
  return <div className="py-6 text-center text-sm text-muted-foreground">{text}</div>;
}

function Overview({ data }: { data: DashboardState }) {
  const u = data.unifi;
  const { unit } = useTempUnit();
  const lh = data.network.latencyHistory;
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
        <div className="mb-3 text-2xl font-semibold text-foreground">{u.gateway.model}</div>
        <StatList>
          <StatRow label="Firmware" value={u.gateway.fwVersion} />
          <StatRow label="Uptime" value={u.gateway.uptime} />
          <StatRow label="CPU" value={`${u.gateway.cpu.toFixed(0)}%`} />
          <StatRow label="RAM" value={`${u.gateway.ram.toFixed(0)}%`} />
          <StatRow label="Temp" value={fmtTemp(u.gateway.tempC, unit)} />
          <StatRow label="Public IP" value={u.wan.public} />
          {u.appVersion ? <StatRow label="App Version" value={u.appVersion} /> : null}
        </StatList>
      </SectionCard>

      <NetworkTile data={data.network} span={8} chartKind="area" expandable={false} />
      <InternetTile data={data.network} span={6} expandable={false} />

      <SectionCard
        span={6}
        title="Latency · last 60 ticks"
        icon={<Activity size={14} strokeWidth={1.75} />}
      >
        <AreaChart data={lh} height={120} />
        <StatList className="mt-2">
          <StatRow label="Current" value={`${data.network.latencyMs.toFixed(1)} ms`} />
          <StatRow label="Min" value={`${lh.length ? Math.min(...lh).toFixed(1) : '—'} ms`} />
          <StatRow label="Max" value={`${lh.length ? Math.max(...lh).toFixed(1) : '—'} ms`} />
        </StatList>
      </SectionCard>
    </div>
  );
}

function Devices({ data }: { data: DashboardState }) {
  const u = data.unifi;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SectionCard
        span={6}
        sub={u.aps.length}
        title="Wi-Fi Access Points"
        icon={
          <span className="flex items-center gap-1.5">
            <NetworkBrandIcon />
            <Wifi size={14} strokeWidth={1.75} />
          </span>
        }
      >
        {u.aps.length === 0
          ? emptyRow('No APs detected')
          : u.aps.map((ap) => (
              <ListRow
                key={ap.name}
                dot={ap.state === 'ONLINE' ? 'ok' : 'bad'}
                name={ap.name}
                meta={
                  <>
                    {ap.model}
                    {ap.channel !== 'n/a' && ` · ch${ap.channel}`}
                    {ap.frequency ? ` · ${ap.frequency}GHz` : ''}
                  </>
                }
                val={`${ap.clients} clients`}
              />
            ))}
      </SectionCard>

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
        {u.switches.length === 0
          ? emptyRow('No switches detected')
          : u.switches.map((s) => {
              const pct = s.poeMaxW ? (s.poeUsedW / s.poeMaxW) * 100 : 0;
              return (
                <div
                  key={s.name}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
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
            })}
      </SectionCard>
    </div>
  );
}

function Clients({ data }: { data: DashboardState }) {
  const u = data.unifi;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <TopTalkersTile data={u.topTalkers} span={12} expandable={false} />
    </div>
  );
}

function Config({ data }: { data: DashboardState }) {
  const u = data.unifi;
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SectionCard
        span={6}
        sub={u.networks.length}
        title="Networks & VLANs"
        icon={<NetworkBrandIcon />}
      >
        {u.networks.length === 0
          ? emptyRow('No networks data')
          : u.networks.map((n) => (
              <ListRow
                key={n.id}
                dot={n.enabled ? 'ok' : 'idle'}
                name={n.name}
                meta={
                  <>
                    {n.vlanId !== null ? `VLAN ${n.vlanId}` : 'Default'}
                    {n.isDefault ? ' · default' : ''}
                  </>
                }
                val={n.management}
              />
            ))}
      </SectionCard>

      <SectionCard span={6} sub={u.ssids.length} title="Wi-Fi SSIDs" icon={<NetworkBrandIcon />}>
        {u.ssids.length === 0
          ? emptyRow('No SSID data')
          : u.ssids.map((s) => (
              <ListRow
                key={s.id}
                dot={s.enabled ? 'ok' : 'idle'}
                name={s.name}
                meta={
                  <>
                    {s.security}
                    {s.broadcastingFrequencies.length > 0 &&
                      ` · ${s.broadcastingFrequencies.map((f) => `${f}GHz`).join(', ')}`}
                  </>
                }
                val={s.enabled ? 'active' : 'disabled'}
              />
            ))}
      </SectionCard>

      <SectionCard
        span={4}
        title="Firewall"
        icon={
          <span className="flex items-center gap-1.5">
            <NetworkBrandIcon />
            <Shield size={14} strokeWidth={1.75} />
          </span>
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

      <SectionCard
        span={4}
        sub={u.vpnServers.length}
        title="VPN Servers"
        icon={<Lock size={14} strokeWidth={1.75} />}
      >
        {u.vpnServers.length === 0
          ? emptyRow('No VPN servers')
          : u.vpnServers.map((v) => {
              const brand = vpnBrand(v.type);
              return (
                <ListRow
                  key={v.id}
                  dot={v.enabled ? 'ok' : 'idle'}
                  name={v.name}
                  meta={
                    <>
                      {brand ? <BrandIcon name={brand} size={14} alt={v.type} /> : null}
                      {v.type}
                    </>
                  }
                  val={v.enabled ? 'active' : 'disabled'}
                />
              );
            })}
      </SectionCard>

      <SectionCard
        span={4}
        sub={u.dnsRecords.length}
        title="DNS Records"
        icon={
          <span className="flex items-center gap-1.5">
            <NetworkBrandIcon />
            <Globe size={14} strokeWidth={1.75} />
          </span>
        }
      >
        {u.dnsRecords.length === 0
          ? emptyRow('No local DNS records')
          : u.dnsRecords.map((r) => (
              <ListRow key={r.id} dot={r.enabled ? 'ok' : 'idle'} name={r.domain} val={r.type} />
            ))}
      </SectionCard>
    </div>
  );
}

export function NetworkPage({ data, sub }: Props) {
  if (sub === 'devices') return <Devices data={data} />;
  if (sub === 'clients') return <Clients data={data} />;
  if (sub === 'config') return <Config data={data} />;
  return <Overview data={data} />;
}
