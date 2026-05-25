import { Tile } from '../tile/Tile';
import type { ProtectData, Severity } from '../../types';

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
  const { total, connected, disconnected, nvr, recentEvents } = data;
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
      <div className="t-big">
        {connected}
        <small> / {total} online</small>
      </div>
      <div className="t-sub">
        {latest
          ? <>last event {new Date(latest.start).toLocaleTimeString()}</>
          : 'no recent events'}
      </div>
    </Tile>
  );
}
