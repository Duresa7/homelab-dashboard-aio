import { Icon, type IconName } from '../icons/Icon';
import type { AlertEntry } from '../../types';

export type Route =
  | 'overview' | 'proxmox' | 'unifi' | 'docker' | 'storage' | 'events' | 'alerts';

interface Props {
  route: Route;
  setRoute: (r: Route) => void;
  alerts: AlertEntry[];
}

type Item =
  | { sect: string }
  | { id: Route; label: string; icon: IconName; badge?: string | number; badgeKind?: '' | 'warn' | 'bad' };

export function Sidebar({ route, setRoute, alerts }: Props) {
  const items: Item[] = [
    { id: 'overview', label: 'Overview', icon: 'home' },
    { sect: 'systems' },
    { id: 'proxmox', label: 'Proxmox', icon: 'server', badge: '1 node' },
    { id: 'unifi', label: 'Network', icon: 'network' },
    { id: 'docker', label: 'Docker', icon: 'box', badge: '20' },
    { id: 'storage', label: 'Storage', icon: 'disk' },
    { sect: 'observability' },
    { id: 'events', label: 'Events', icon: 'activity' },
    {
      id: 'alerts',
      label: 'Alerts',
      icon: 'bell',
      badge: alerts.length || 0,
      badgeKind: alerts.some((a) => a.kind === 'bad') ? 'bad' : alerts.length ? 'warn' : '',
    },
  ];
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-mark">⌬</div>
        <div>
          homelab<span style={{ color: 'var(--ink-3)' }}>.local</span>
        </div>
      </div>
      {items.map((it, i) => {
        if ('sect' in it) return <div key={`s${i}`} className="sb-section">{it.sect}</div>;
        const showBadge = Boolean(it.badge);
        return (
          <button
            key={it.id}
            className={`sb-link ${route === it.id ? 'is-active' : ''}`}
            onClick={() => setRoute(it.id)}
          >
            <Icon name={it.icon} className="ico" />
            {it.label}
            {showBadge ? <span className={`badge ${it.badgeKind ?? ''}`}>{it.badge}</span> : null}
          </button>
        );
      })}
      <div className="sb-foot">
        <span className="sb-status-dot" />
        all systems nominal
      </div>
    </aside>
  );
}
