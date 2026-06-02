import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Camera as CameraIcon,
  Mic,
  Volume2,
  Sparkles,
  Package,
  ScanFace,
  Activity,
  Video,
} from 'lucide-react';
import { CameraSnapshot } from '../components/widgets/CameraSnapshot';
import { CameraLiveStream } from '../components/widgets/CameraLiveStream';
import { CameraFullscreen, type CameraViewMode } from '../components/widgets/CameraFullscreen';
import { BrandIcon } from '../components/icons/BrandIcon';
import {
  SectionCard,
  DataTableCard,
  StatList,
  StatRow,
  StatusBadge,
  Segmented,
} from '@/components/common';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import type {
  DashboardState,
  ProtectArmStatus,
  ProtectCamera,
  ProtectEvent,
  Severity,
} from '../types';

interface Props {
  data: DashboardState;
  sub: string;
}

// A click hint that overlays any camera tile and triggers the fullscreen
// modal. Keeps the leaf snapshot/live components unaware of the page-level
// expansion state.
function ClickableTile({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      className="relative cursor-zoom-in"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
}

function armSeverity(status: ProtectArmStatus): Severity {
  if (status === 'breach') return 'bad';
  if (status === 'arming') return 'warn';
  if (status === 'armed') return 'ok';
  return 'info';
}

function armLabel(status: ProtectArmStatus): string {
  switch (status) {
    case 'armed':
      return 'armed';
    case 'arming':
      return 'arming';
    case 'breach':
      return 'breach';
    case 'disabled':
      return 'disarmed';
    default:
      return String(status);
  }
}

function formatSince(ts: number | null): string {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}

function NvrCard({ data }: { data: DashboardState }) {
  const { protect } = data;
  if (!protect.nvr) return null;
  const { nvr } = protect;
  const sev = armSeverity(nvr.armMode.status);
  return (
    <SectionCard
      span={4}
      icon={<BrandIcon name="unifi" alt="UniFi Protect" />}
      title={
        <span className="flex items-center gap-2">
          NVR
          <StatusBadge kind={sev} pulse={nvr.armMode.status === 'armed'}>
            {armLabel(nvr.armMode.status)}
          </StatusBadge>
        </span>
      }
    >
      <StatList>
        <StatRow label="Name" value={nvr.name} />
        <StatRow label="Model" value={nvr.modelKey || '—'} />
        {nvr.armMode.status === 'armed' && (
          <StatRow label="Armed" value={formatSince(nvr.armMode.armedAt)} />
        )}
        {nvr.armMode.status === 'arming' && (
          <StatRow
            label="Activates"
            value={
              nvr.armMode.willBeArmedAt
                ? new Date(nvr.armMode.willBeArmedAt).toLocaleTimeString()
                : '—'
            }
          />
        )}
        {nvr.armMode.status === 'breach' && (
          <>
            <StatRow label="Detected" value={formatSince(nvr.armMode.breachDetectedAt)} />
            <StatRow label="Events" value={nvr.armMode.breachEventCount} />
          </>
        )}
        {protect.appVersion ? <StatRow label="App version" value={protect.appVersion} /> : null}
      </StatList>
    </SectionCard>
  );
}

function StatusCard({ data }: { data: DashboardState }) {
  const { protect } = data;
  const Stat = ({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) => (
    <div className="flex flex-col gap-0.5">
      <span
        className={`font-display text-3xl leading-none font-semibold tabular-nums ${tone ?? 'text-foreground'}`}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
  return (
    <SectionCard span={4} title="Fleet" icon={<BrandIcon name="unifi" alt="UniFi Protect" />}>
      <div className="flex gap-8 pt-1">
        <Stat value={protect.connected} label="online" />
        <Stat
          value={protect.disconnected}
          label="offline"
          tone={protect.disconnected ? 'text-warn' : undefined}
        />
        <Stat value={protect.total} label="total" />
      </div>
    </SectionCard>
  );
}

function FeaturesCard({ data }: { data: DashboardState }) {
  const cams = data.protect.cameras;
  const hasMic = cams.filter((c) => c.hasMic).length;
  const hasSpeaker = cams.filter((c) => c.hasSpeaker).length;
  const hasHdr = cams.filter((c) => c.hasHdr).length;
  const hasPkg = cams.filter((c) => c.hasPackageCamera).length;
  const smartTypes = new Set<string>();
  cams.forEach((c) => c.enabledObjectTypes.forEach((t) => smartTypes.add(t)));
  const iconLabel = (icon: ReactNode, text: string) => (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground [&_svg]:size-3">{icon}</span>
      {text}
    </span>
  );
  return (
    <SectionCard span={4} title="Capabilities" icon={<Sparkles size={14} strokeWidth={1.75} />}>
      <StatList>
        <StatRow label={iconLabel(<Mic strokeWidth={1.75} />, 'With microphone')} value={hasMic} />
        <StatRow
          label={iconLabel(<Volume2 strokeWidth={1.75} />, 'With speaker')}
          value={hasSpeaker}
        />
        <StatRow label={iconLabel(<Video strokeWidth={1.75} />, 'HDR-capable')} value={hasHdr} />
        <StatRow label={iconLabel(<Package strokeWidth={1.75} />, 'Package cam')} value={hasPkg} />
        <StatRow
          label={iconLabel(<ScanFace strokeWidth={1.75} />, 'Smart detect')}
          value={smartTypes.size ? [...smartTypes].join(', ') : 'none enabled'}
        />
      </StatList>
    </SectionCard>
  );
}

type OpenFn = (camera: ProtectCamera, mode: CameraViewMode) => void;

function Overview({ data, onOpen }: { data: DashboardState; onOpen: OpenFn }) {
  const { protect } = data;
  const preview = useMemo(
    () =>
      [...protect.cameras]
        .sort((a, b) => Number(b.state === 'CONNECTED') - Number(a.state === 'CONNECTED'))
        .slice(0, 6),
    [protect.cameras],
  );

  if (protect.total === 0) {
    return (
      <div className="grid grid-cols-12 gap-[var(--gap)]">
        <SectionCard span={12} title="UniFi Protect">
          <div className="py-10 text-center text-sm text-muted-foreground">
            No cameras reported. Check that PROTECT_ENABLED is true and PROTECT_API_KEY is set.
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <StatusCard data={data} />
      <NvrCard data={data} />
      <FeaturesCard data={data} />
      <SectionCard
        span={12}
        title="Live snapshots"
        sub={`top ${preview.length}`}
        icon={<CameraIcon size={14} strokeWidth={1.75} />}
        bodyClassName="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]"
      >
        {preview.map((cam) => (
          <ClickableTile key={cam.id} onClick={() => onOpen(cam, 'snapshot')}>
            <CameraSnapshot camera={cam} intervalMs={5000} />
          </ClickableTile>
        ))}
      </SectionCard>
    </div>
  );
}

type StreamQuality = 'high' | 'medium' | 'low';

function Grid({ data, onOpen }: { data: DashboardState; onOpen: OpenFn }) {
  const cams = data.protect.cameras;
  const [mode, setMode] = useState<'live' | 'snapshot'>('snapshot');
  const [quality, setQuality] = useState<StreamQuality>('medium');
  const [hq, setHq] = useState(false);
  const [interval, setIntervalMs] = useState(4000);

  if (cams.length === 0) {
    return (
      <div className="grid grid-cols-12 gap-[var(--gap)]">
        <SectionCard span={12}>
          <div className="py-10 text-center text-sm text-muted-foreground">
            No cameras to display.
          </div>
        </SectionCard>
      </div>
    );
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented
        value={mode}
        onChange={(v) => setMode(v as 'live' | 'snapshot')}
        options={[
          { value: 'snapshot', label: 'Snapshots' },
          { value: 'live', label: 'Live' },
        ]}
      />
      {mode === 'live' ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Quality</span>
          <Select value={quality} onValueChange={(v) => setQuality(v as StreamQuality)}>
            <SelectTrigger size="sm" className="w-[92px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">low</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="high">high</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={hq} onCheckedChange={setHq} />
            High quality
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Refresh</span>
            <Select value={String(interval)} onValueChange={(v) => setIntervalMs(Number(v))}>
              <SelectTrigger size="sm" className="w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2000">2s</SelectItem>
                <SelectItem value="4000">4s</SelectItem>
                <SelectItem value="8000">8s</SelectItem>
                <SelectItem value="15000">15s</SelectItem>
                <SelectItem value="30000">30s</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SectionCard
        span={12}
        title="All cameras"
        sub={cams.length}
        icon={<CameraIcon size={14} strokeWidth={1.75} />}
        actions={controls}
        bodyClassName="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]"
      >
        {cams.map((cam) => (
          <ClickableTile key={cam.id} onClick={() => onOpen(cam, mode)}>
            {mode === 'live' ? (
              <CameraLiveStream camera={cam} quality={quality} />
            ) : (
              <CameraSnapshot camera={cam} highQuality={hq} intervalMs={interval} />
            )}
          </ClickableTile>
        ))}
      </SectionCard>
    </div>
  );
}

interface EventRow extends ProtectEvent {
  cameraName?: string;
}

function deviceLabel(e: EventRow): ReactNode {
  if (e.cameraName) return e.cameraName;
  if (e.device)
    return (
      <span className="font-mono text-xs text-muted-foreground">
        device · {e.device.slice(0, 8)}
      </span>
    );
  return '—';
}

function eventSeverity(e: ProtectEvent): Severity {
  const t = e.type.toLowerCase();
  if (
    t.includes('alarm') ||
    t.includes('breach') ||
    (t === 'smartdetectzone' && e.smartDetectTypes.includes('person'))
  )
    return 'warn';
  if (t.includes('ring') || t.includes('smartdetect')) return 'info';
  if (t.includes('motion')) return 'info';
  if (t.includes('connect')) return 'ok';
  if (t.includes('disconnect') || t.includes('offline')) return 'bad';
  return 'info';
}

function formatTimeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleString();
}

function formatEventType(e: ProtectEvent): string {
  let label = e.type
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
  if (e.smartDetectTypes?.length) {
    label += ` · ${e.smartDetectTypes.join(', ')}`;
  }
  return label;
}

function summariseMetadata(e: ProtectEvent): string {
  const md = e.metadata;
  if (!md || Object.keys(md).length === 0) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(md)) {
    if (v == null) continue;
    if (typeof v === 'object') continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.join(' · ');
}

function Events({ data }: { data: DashboardState }) {
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDevice, setFilterDevice] = useState<string>('all');
  const [events, setEvents] = useState<ProtectEvent[] | null>(null);
  const [connected, setConnected] = useState<boolean>(data.protect.eventsConnected);
  const [lastError, setLastError] = useState<string | null>(null);

  // The main /api/protect payload includes the last 50. For the dedicated
  // Events tab we hit /api/protect/events directly so we get the full ring
  // buffer (up to 500) and can refresh more often than the global poller.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const params = new URLSearchParams({ limit: '200' });
        if (filterDevice !== 'all') params.set('device', filterDevice);
        if (filterType !== 'all') params.set('type', filterType);
        const res = await fetch(`/api/protect/events?${params}`);
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        if (payload.disabled) return;
        setEvents(Array.isArray(payload.events) ? payload.events : []);
        setConnected(!!payload.connected);
        setLastError(payload.lastError || null);
      } catch {
        /* keep last good */
      }
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [filterDevice, filterType]);

  const visible: EventRow[] = useMemo(() => {
    const list = events ?? data.protect.recentEvents;
    const normalize = (s: string) => s.replace(/:/g, '').toLowerCase();
    const byKey = new Map<string, string>();
    data.protect.cameras.forEach((c) => {
      if (c.id) byKey.set(normalize(c.id), c.name);
      if (c.mac) byKey.set(normalize(c.mac), c.name);
    });
    if (data.protect.nvr) {
      byKey.set(normalize(data.protect.nvr.id), data.protect.nvr.name);
    }
    return list.map((e) => ({
      ...e,
      cameraName: e.device ? byKey.get(normalize(e.device)) : undefined,
    }));
  }, [events, data.protect.recentEvents, data.protect.cameras, data.protect.nvr]);

  const types = useMemo(() => {
    const set = new Set<string>();
    (events ?? data.protect.recentEvents).forEach((e) => set.add(e.type));
    return [...set].sort();
  }, [events, data.protect.recentEvents]);

  const filters = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Device</span>
        <Select value={filterDevice} onValueChange={setFilterDevice}>
          <SelectTrigger size="sm" className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            {data.protect.cameras.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Type</span>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger size="sm" className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {lastError ? (
        <div className="rounded-lg border border-[color-mix(in_oklab,var(--bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] px-3.5 py-2.5 text-sm text-bad">
          {lastError}
        </div>
      ) : null}
      <DataTableCard
        span={12}
        title={
          <span className="flex items-center gap-2">
            Events
            <StatusBadge kind={connected ? 'ok' : 'bad'} pulse={connected}>
              {connected ? 'live' : 'disconnected'}
            </StatusBadge>
          </span>
        }
        icon={<Activity size={14} strokeWidth={1.75} />}
        actions={filters}
        isEmpty={visible.length === 0}
        empty={events === null ? 'loading…' : 'no events in buffer yet'}
        head={
          <>
            <TableHead>When</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Details</TableHead>
          </>
        }
      >
        {visible.map((e) => {
          const sev = eventSeverity(e);
          const dur = e.end ? `${Math.max(1, Math.round((e.end - e.start) / 1000))}s` : 'ongoing';
          return (
            <TableRow key={`${e.id}-${e.seq}`}>
              <TableCell
                className="tabular-nums text-muted-foreground"
                title={new Date(e.start).toLocaleString()}
              >
                {formatTimeAgo(e.start)}
              </TableCell>
              <TableCell className="text-foreground">{deviceLabel(e)}</TableCell>
              <TableCell>
                <StatusBadge kind={sev}>{formatEventType(e)}</StatusBadge>
              </TableCell>
              <TableCell className="font-mono text-xs tabular-nums">{dur}</TableCell>
              <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                {summariseMetadata(e)}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTableCard>
    </div>
  );
}

function modelLabel(c: ProtectCamera) {
  return c.modelKey || '—';
}

function Devices({ data, onOpen }: { data: DashboardState; onOpen: OpenFn }) {
  const cams = data.protect.cameras;
  if (cams.length === 0) {
    return (
      <div className="grid grid-cols-12 gap-[var(--gap)]">
        <SectionCard span={12}>
          <div className="py-10 text-center text-sm text-muted-foreground">No cameras.</div>
        </SectionCard>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <DataTableCard
        span={12}
        title="Devices"
        sub={cams.length}
        icon={<CameraIcon size={14} strokeWidth={1.75} />}
        head={
          <>
            <TableHead>State</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>MAC</TableHead>
            <TableHead>Video</TableHead>
            <TableHead>HDR</TableHead>
            <TableHead>Mic</TableHead>
            <TableHead>Speaker</TableHead>
            <TableHead>Smart detect</TableHead>
            <TableHead>View</TableHead>
          </>
        }
      >
        {cams.map((c) => {
          const ok = c.state === 'CONNECTED';
          const kind = ok ? 'ok' : c.state === 'CONNECTING' ? 'warn' : 'bad';
          return (
            <TableRow key={c.id}>
              <TableCell>
                <StatusBadge kind={kind} pulse={ok}>
                  {c.state.toLowerCase()}
                </StatusBadge>
              </TableCell>
              <TableCell className="font-medium text-foreground">{c.name}</TableCell>
              <TableCell className="font-mono text-muted-foreground">{modelLabel(c)}</TableCell>
              <TableCell className="font-mono text-muted-foreground">{c.mac || '—'}</TableCell>
              <TableCell>{c.videoMode}</TableCell>
              <TableCell>{c.hasHdr ? c.hdrType : '—'}</TableCell>
              <TableCell>
                {c.hasMic ? (c.isMicEnabled ? `${c.micVolume}%` : 'muted') : '—'}
              </TableCell>
              <TableCell>{c.hasSpeaker ? 'yes' : '—'}</TableCell>
              <TableCell>
                {c.enabledObjectTypes.length ? c.enabledObjectTypes.join(', ') : '—'}
              </TableCell>
              <TableCell>
                {ok ? (
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpen(c, 'snapshot')}
                      title="View snapshot"
                    >
                      Snapshot
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpen(c, 'live')}
                      title="View live"
                    >
                      Live
                    </Button>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTableCard>
    </div>
  );
}

interface Expansion {
  camera: ProtectCamera;
  mode: CameraViewMode;
}

export function CamerasPage({ data, sub }: Props) {
  const [expanded, setExpanded] = useState<Expansion | null>(null);

  const open = (camera: ProtectCamera, mode: CameraViewMode) => setExpanded({ camera, mode });

  let body;
  if (sub === 'grid') body = <Grid data={data} onOpen={open} />;
  else if (sub === 'devices') body = <Devices data={data} onOpen={open} />;
  else if (sub === 'events') body = <Events data={data} />;
  else body = <Overview data={data} onOpen={open} />;

  return (
    <>
      {body}
      {expanded ? (
        <CameraFullscreen
          camera={expanded.camera}
          initialMode={expanded.mode}
          onClose={() => setExpanded(null)}
        />
      ) : null}
    </>
  );
}
