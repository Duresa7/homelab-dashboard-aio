import type { DashboardState } from '../../../types';
import { CameraSnapshot } from '../../widgets/CameraSnapshot';

export function ExpandedProtect({ data }: { data: DashboardState }) {
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
