import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Camera as CameraIcon, Mic, Volume2, Sparkles, Package, ScanFace, Activity, Video,
} from 'lucide-react';
import { CameraSnapshot } from '../components/widgets/CameraSnapshot';
import { CameraLiveStream } from '../components/widgets/CameraLiveStream';
import { CameraFullscreen, type CameraViewMode } from '../components/widgets/CameraFullscreen';
import { BrandIcon } from '../components/icons/BrandIcon';
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
function ClickableTile({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      style={{ position: 'relative', cursor: 'zoom-in' }}
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
    case 'armed':    return 'Armed';
    case 'arming':   return 'Arming';
    case 'breach':   return 'BREACH';
    case 'disabled': return 'Disarmed';
    default:         return String(status);
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
    <div className="tile span-4">
      <div className="t-head">
        <div className="t-title">
          <BrandIcon name="unifi" alt="UniFi Protect" />
          NVR
          <span className={`t-tag ${sev}`}>
            {nvr.armMode.status === 'armed' ? <span className="pulse-dot icon-pulse" /> : null}
            {armLabel(nvr.armMode.status)}
          </span>
        </div>
      </div>
      <dl className="kv">
        <dt>Name</dt><dd>{nvr.name}</dd>
        <dt>Model</dt><dd>{nvr.modelKey || '—'}</dd>
        {nvr.armMode.status === 'armed' && (
          <><dt>Armed</dt><dd>{formatSince(nvr.armMode.armedAt)}</dd></>
        )}
        {nvr.armMode.status === 'arming' && (
          <><dt>Activates</dt><dd>{nvr.armMode.willBeArmedAt ? new Date(nvr.armMode.willBeArmedAt).toLocaleTimeString() : '—'}</dd></>
        )}
        {nvr.armMode.status === 'breach' && (
          <>
            <dt>Detected</dt><dd>{formatSince(nvr.armMode.breachDetectedAt)}</dd>
            <dt>Events</dt><dd>{nvr.armMode.breachEventCount}</dd>
          </>
        )}
        {protect.appVersion && (
          <><dt>App version</dt><dd>{protect.appVersion}</dd></>
        )}
      </dl>
    </div>
  );
}

function StatusCard({ data }: { data: DashboardState }) {
  const { protect } = data;
  return (
    <div className="tile span-4">
      <div className="t-title"><BrandIcon name="unifi" alt="UniFi Protect" /> Fleet</div>
      <div className="row" style={{ gap: 14, paddingTop: 4 }}>
        <div>
          <div className="t-big" style={{ fontSize: 28 }}>{protect.connected}</div>
          <div className="t-sub">online</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 28, color: protect.disconnected ? 'var(--warn)' : '' }}>
            {protect.disconnected}
          </div>
          <div className="t-sub">offline</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 28 }}>{protect.total}</div>
          <div className="t-sub">total</div>
        </div>
      </div>
    </div>
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
  return (
    <div className="tile span-4">
      <div className="t-title"><Sparkles size={14} strokeWidth={1.75} />Capabilities</div>
      <dl className="kv">
        <dt><Mic size={12} strokeWidth={1.75} className="kv-icon" />With microphone</dt><dd>{hasMic}</dd>
        <dt><Volume2 size={12} strokeWidth={1.75} className="kv-icon" />With speaker</dt><dd>{hasSpeaker}</dd>
        <dt><Video size={12} strokeWidth={1.75} className="kv-icon" />HDR-capable</dt><dd>{hasHdr}</dd>
        <dt><Package size={12} strokeWidth={1.75} className="kv-icon" />Package cam</dt><dd>{hasPkg}</dd>
        <dt><ScanFace size={12} strokeWidth={1.75} className="kv-icon" />Smart detect</dt>
        <dd>{smartTypes.size ? [...smartTypes].join(', ') : 'none enabled'}</dd>
      </dl>
    </div>
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
      <div className="grid">
        <div className="tile span-12">
          <div className="t-title">UniFi Protect</div>
          <div className="page-empty">
            No cameras reported. Check that PROTECT_ENABLED is true and PROTECT_API_KEY is set.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid">
      <StatusCard data={data} />
      <NvrCard data={data} />
      <FeaturesCard data={data} />
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title"><CameraIcon size={14} strokeWidth={1.75} />Live snapshots <span className="t-sub">· top {preview.length}</span></div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
            paddingTop: 8,
          }}
        >
          {preview.map((cam) => (
            <ClickableTile key={cam.id} onClick={() => onOpen(cam, 'snapshot')}>
              <CameraSnapshot camera={cam} intervalMs={5000} />
            </ClickableTile>
          ))}
        </div>
      </div>
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
      <div className="grid">
        <div className="tile span-12">
          <div className="page-empty">No cameras to display.</div>
        </div>
      </div>
    );
  }

  const radio = (val: 'live' | 'snapshot', label: string) => (
    <label className="t-sub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="radio"
        name="cam-mode"
        checked={mode === val}
        onChange={() => setMode(val)}
      />
      {label}
    </label>
  );

  return (
    <div className="grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title"><CameraIcon size={14} strokeWidth={1.75} />All cameras <span className="t-sub">· {cams.length}</span></div>
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              {radio('snapshot', 'Snapshots')}
              {radio('live', 'Live')}
            </div>
            {mode === 'live' ? (
              <label className="t-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Quality
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as StreamQuality)}
                  style={{ background: 'transparent', color: 'inherit', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 4px' }}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
            ) : (
              <>
                <label className="t-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={hq} onChange={(e) => setHq(e.target.checked)} />
                  High quality
                </label>
                <label className="t-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Refresh
                  <select
                    value={interval}
                    onChange={(e) => setIntervalMs(Number(e.target.value))}
                    style={{ background: 'transparent', color: 'inherit', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 4px' }}
                  >
                    <option value={2000}>2s</option>
                    <option value={4000}>4s</option>
                    <option value={8000}>8s</option>
                    <option value={15000}>15s</option>
                    <option value={30000}>30s</option>
                  </select>
                </label>
              </>
            )}
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 10,
            paddingTop: 8,
          }}
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
        </div>
      </div>
    </div>
  );
}

interface EventRow extends ProtectEvent {
  cameraName?: string;
}

function deviceLabel(e: EventRow): ReactNode {
  if (e.cameraName) return e.cameraName;
  if (e.device) return <span className="t-sub mono">device · {e.device.slice(0, 8)}</span>;
  return '—';
}

function eventSeverity(e: ProtectEvent): Severity {
  const t = e.type.toLowerCase();
  if (t.includes('alarm') || t.includes('breach') || t === 'smartdetectzone' && e.smartDetectTypes.includes('person')) return 'warn';
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
      } catch { /* keep last good */ }
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => { cancelled = true; window.clearInterval(id); };
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

  return (
    <div className="grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">
            <Activity size={14} strokeWidth={1.75} />
            Events
            <span className={`t-tag ${connected ? 'ok' : 'bad'}`}>
              {connected ? <span className="pulse-dot icon-pulse" /> : null}
              {connected ? 'live' : 'disconnected'}
            </span>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <label className="t-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Device
              <select
                value={filterDevice}
                onChange={(e) => setFilterDevice(e.target.value)}
                style={{ background: 'transparent', color: 'inherit', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 4px' }}
              >
                <option value="all">all</option>
                {data.protect.cameras.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="t-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Type
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                style={{ background: 'transparent', color: 'inherit', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 4px' }}
              >
                <option value="all">all</option>
                {types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {lastError ? (
          <div className="t-sub" style={{ color: 'var(--bad)', paddingTop: 4 }}>
            {lastError}
          </div>
        ) : null}
        {visible.length === 0 ? (
          <div className="page-empty">
            {events === null ? 'loading…' : 'no events in buffer yet'}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Device</th>
                <th>Type</th>
                <th>Duration</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const sev = eventSeverity(e);
                const dur = e.end ? `${Math.max(1, Math.round((e.end - e.start) / 1000))}s` : 'ongoing';
                return (
                  <tr key={`${e.id}-${e.seq}`}>
                    <td title={new Date(e.start).toLocaleString()}>{formatTimeAgo(e.start)}</td>
                    <td>{deviceLabel(e)}</td>
                    <td>
                      <span className={`pill ${sev}`}>
                        <span className="dot" />
                        {formatEventType(e)}
                      </span>
                    </td>
                    <td className="mono">{dur}</td>
                    <td className="t-sub">{summariseMetadata(e)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
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
      <div className="grid">
        <div className="tile span-12"><div className="page-empty">No cameras.</div></div>
      </div>
    );
  }
  return (
    <div className="grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title"><CameraIcon size={14} strokeWidth={1.75} />Devices <span className="t-sub">· {cams.length}</span></div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Name</th>
              <th>Model</th>
              <th>MAC</th>
              <th>Video</th>
              <th>HDR</th>
              <th>Mic</th>
              <th>Speaker</th>
              <th>Smart detect</th>
              <th>View</th>
            </tr>
          </thead>
          <tbody>
            {cams.map((c) => {
              const ok = c.state === 'CONNECTED';
              const pill = ok ? 'ok' : c.state === 'CONNECTING' ? 'warn' : 'bad';
              return (
                <tr key={c.id}>
                  <td>
                    <span className={`pill ${pill}`}>
                      <span className={`dot ${ok ? 'icon-pulse' : ''}`} />
                      {c.state.toLowerCase()}
                    </span>
                  </td>
                  <td>{c.name}</td>
                  <td className="mono">{modelLabel(c)}</td>
                  <td className="mono">{c.mac || '—'}</td>
                  <td>{c.videoMode}</td>
                  <td>{c.hasHdr ? c.hdrType : '—'}</td>
                  <td>{c.hasMic ? (c.isMicEnabled ? `${c.micVolume}%` : 'muted') : '—'}</td>
                  <td>{c.hasSpeaker ? 'yes' : '—'}</td>
                  <td>{c.enabledObjectTypes.length ? c.enabledObjectTypes.join(', ') : '—'}</td>
                  <td>
                    {ok ? (
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="icon-btn"
                          onClick={() => onOpen(c, 'snapshot')}
                          title="View snapshot"
                          style={{ padding: '2px 8px', height: 24 }}
                        >
                          Snapshot
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => onOpen(c, 'live')}
                          title="View live"
                          style={{ padding: '2px 8px', height: 24 }}
                        >
                          Live
                        </button>
                      </div>
                    ) : (
                      <span className="t-sub">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Expansion {
  camera: ProtectCamera;
  mode: CameraViewMode;
}

export function CamerasPage({ data, sub }: Props) {
  const [expanded, setExpanded] = useState<Expansion | null>(null);

  const open = (camera: ProtectCamera, mode: CameraViewMode) =>
    setExpanded({ camera, mode });

  let body;
  if (sub === 'grid')         body = <Grid    data={data} onOpen={open} />;
  else if (sub === 'devices') body = <Devices data={data} onOpen={open} />;
  else if (sub === 'events')  body = <Events  data={data} />;
  else                        body = <Overview data={data} onOpen={open} />;

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
