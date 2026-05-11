import { Tile } from '../tile/Tile';

interface Props {
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

const NODES = [
  { name: 'pve-01', kind: 'Proxmox', state: 'up' },
  { name: 'unas-2', kind: 'UniFi NAS', state: 'up' },
  { name: 'udm-pro', kind: 'UniFi Gateway', state: 'up' },
  { name: 'switch-pro-24', kind: 'Switch', state: 'up' },
  { name: 'switch-flex', kind: 'Switch', state: 'up' },
  { name: 'ap-office', kind: 'AP', state: 'up' },
  { name: 'ap-living', kind: 'AP', state: 'up' },
  { name: 'ap-bedroom', kind: 'AP', state: 'up' },
  { name: 'ap-garage', kind: 'AP', state: 'up' },
  { name: 'pi-hole', kind: 'LXC', state: 'up' },
  { name: 'docker-host', kind: 'LXC', state: 'up' },
  { name: 'dev-vm', kind: 'VM', state: 'down' },
];

export function NodesTile({ span, onExpand, expandable }: Props) {
  const up = NODES.filter((n) => n.state === 'up').length;
  return (
    <Tile
      title="Nodes"
      sub={`${up}/${NODES.length} up`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{
        label: up === NODES.length ? 'all up' : `${NODES.length - up} down`,
        kind: up === NODES.length ? 'ok' : 'warn',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
        {NODES.map((n) => (
          <div
            key={n.name}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              background: 'var(--surface-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span
                style={{
                  width: 6, height: 6, borderRadius: 50,
                  background: n.state === 'up' ? 'var(--ok)' : 'var(--bad)',
                }}
              />
              {n.name}
            </div>
            <div className="t-sub mono" style={{ fontSize: 10 }}>{n.kind}</div>
          </div>
        ))}
      </div>
    </Tile>
  );
}
