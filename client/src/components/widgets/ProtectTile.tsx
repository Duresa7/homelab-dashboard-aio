import { Tile } from '../tile/Tile';
import type { ProtectData, Severity } from '../../types';
import { CameraSnapshot } from './CameraSnapshot';

interface Props {
  data: ProtectData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

function armKind(status: string): { label: string; kind: Severity } {
  switch (status) {
    case 'armed':    return { label: 'Armed',    kind: 'ok' };
    case 'arming':   return { label: 'Arming',   kind: 'warn' };
    case 'breach':   return { label: 'BREACH',   kind: 'bad' };
    case 'disabled':
    default:         return { label: 'Disarmed', kind: 'info' };
  }
}

export function ProtectTile({ data, span, onExpand, expandable }: Props) {
  const { cameras, total, connected, disconnected, nvr, recentEvents } = data;
  // Preview up to 4 connected cameras in the overview tile.
  const preview = cameras
    .filter((c) => c.state === 'CONNECTED')
    .slice(0, 4);
  const latest = recentEvents?.[0];
  const arm = nvr ? armKind(nvr.armMode.status) : null;
  const tag = arm
    ? { label: arm.label, kind: arm.kind }
    : { label: `${connected}/${total}`, kind: disconnected ? 'warn' as const : 'ok' as const };

  return (
    <Tile
      title="Cameras"
      sub={nvr ? nvr.name : 'UniFi Protect'}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={tag}
    >
      <div className="row" style={{ gap: 14, paddingBottom: 6, borderBottom: '1px dashed var(--line)' }}>
        <div>
          <div className="t-big" style={{ fontSize: 28 }}>{connected}</div>
          <div className="t-sub">online</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 28, color: disconnected ? 'var(--warn)' : '' }}>
            {disconnected}
          </div>
          <div className="t-sub">offline</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 28 }}>{total}</div>
          <div className="t-sub">total</div>
        </div>
      </div>
      {preview.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 6,
            paddingTop: 8,
          }}
        >
          {preview.map((cam) => (
            <CameraSnapshot key={cam.id} camera={cam} intervalMs={6000} />
          ))}
        </div>
      ) : (
        <div className="page-empty" style={{ paddingTop: 8 }}>
          {total === 0 ? 'No cameras reported' : 'No connected cameras'}
        </div>
      )}
      {latest ? (
        <div
          className="t-sub"
          style={{ paddingTop: 6, borderTop: '1px dashed var(--line)', display: 'flex', justifyContent: 'space-between' }}
        >
          <span>
            Latest:&nbsp;
            <span style={{ color: 'var(--accent)' }}>{latest.type}</span>
            {latest.smartDetectTypes.length ? ` (${latest.smartDetectTypes.join(', ')})` : ''}
          </span>
          <span>{new Date(latest.start).toLocaleTimeString()}</span>
        </div>
      ) : null}
    </Tile>
  );
}
