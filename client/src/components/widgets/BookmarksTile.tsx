import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Tile } from '../tile/Tile';
import { getState, setState, subscribe as subscribeState } from '../../lib/store';

interface Props {
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

interface BookmarkDef {
  id: string;
  url: string;
  label: string;
  /** Primary icon URL — dashboardicons.com via jsDelivr, or a domain favicon. */
  src: string;
}

const DI = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg';
const favicon = (host: string) => `https://www.google.com/s2/favicons?domain=${host}&sz=128`;

const BOOKMARKS: BookmarkDef[] = [
  {
    id: 'bm-proxmox',
    url: 'https://198.51.100.10:8006/#v1:0:18:4:::::::',
    label: 'Proxmox',
    src: `${DI}/proxmox.svg`,
  },
  {
    id: 'bm-unifi-gw',
    url: 'https://198.51.100.10/network/default/dashboard',
    label: 'UniFi Network',
    src: `${DI}/unifi-controller.svg`,
  },
  {
    id: 'bm-unifi-drive',
    url: 'https://198.51.100.10/drive/dashboard',
    label: 'UniFi Drive',
    src: `${DI}/unifi-drive.svg`,
  },
  {
    id: 'bm-unifi-cloud',
    url: 'https://unifi.ui.com/',
    label: 'Site Manager',
    src: `${DI}/ubiquiti.svg`,
  },
  {
    id: 'bm-npm',
    url: 'http://198.51.100.10:81/',
    label: 'Proxy Manager',
    src: `${DI}/nginx-proxy-manager.svg`,
  },
  {
    id: 'bm-immich',
    url: 'http://198.51.100.10:2283/photos',
    label: 'Immich',
    src: `${DI}/immich.svg`,
  },
  {
    id: 'bm-umami',
    url: 'https://umami.example.test/websites',
    label: 'Umami',
    src: `${DI}/umami.svg`,
  },
  {
    id: 'bm-portainer',
    url: 'https://198.51.100.10:9443/#!/home',
    label: 'Portainer',
    src: `${DI}/portainer.svg`,
  },
  {
    id: 'bm-supabase',
    url: 'http://198.51.100.10:8000/project/default',
    label: 'Supabase',
    src: `${DI}/supabase.svg`,
  },
  {
    id: 'bm-personal',
    url: 'https://example-user.example.test/',
    label: 'example-user',
    src: favicon('example-user.example.test'),
  },
  {
    id: 'bm-github',
    url: 'http://198.51.100.10:3000/',
    label: 'GitHub',
    src: `${DI}/github.svg`,
  },
  {
    id: 'bm-wazuh',
    url: 'https://198.51.100.10/app/wz-home',
    label: 'Wazuh',
    src: `${DI}/wazuh.svg`,
  },
  { id: 'bm-sshid', url: 'https://sshid.io/example-user2', label: 'SSHID', src: favicon('sshid.io') },
  {
    id: 'bm-prometheus',
    url: 'http://198.51.100.10:9090/query',
    label: 'Prometheus',
    src: `${DI}/prometheus.svg`,
  },
  {
    id: 'bm-grafana',
    url: 'http://198.51.100.10:3000/d/rYdddlPWk/node-exporter-full?orgId=1&from=now-24h&to=now&timezone=browser&var-ds_prometheus=bfgnkdi47u5tsa&var-job=example-server&var-nodename=example-server&var-node=198.51.100.10:9100&refresh=1m',
    label: 'Grafana',
    src: `${DI}/grafana.svg`,
  },
  {
    id: 'bm-coolify-lan',
    url: 'http://198.51.100.10:8000/',
    label: 'Coolify',
    src: `${DI}/coolify.svg`,
  },
  {
    id: 'bm-coolify-a1',
    url: 'https://coolify-a1.example.test/',
    label: 'Coolify a1',
    src: `${DI}/coolify.svg`,
  },
  {
    id: 'bm-cloudflare',
    url: 'https://dash.cloudflare.com/',
    label: 'Cloudflare',
    src: `${DI}/cloudflare.svg`,
  },
  {
    id: 'bm-example-org',
    url: 'https://www.example.test/',
    label: 'Alpha Sec',
    src: favicon('example.test'),
  },
  {
    id: 'bm-supabase-cloud',
    url: 'https://supabase.com/dashboard/organizations',
    label: 'Supabase Cloud',
    src: `${DI}/supabase.svg`,
  },
  {
    id: 'bm-vercel',
    url: 'https://vercel.com/example-projects',
    label: 'Vercel',
    src: `${DI}/vercel.svg`,
  },
  {
    id: 'bm-ts3manager',
    url: 'http://198.51.100.10:9000/servers',
    label: 'TS3Manager',
    src: `${DI}/teamspeak.svg`,
  },
];

const STORE_KEY = 'bookmarksOrder';

function loadOrder(): string[] {
  const fallback = BOOKMARKS.map((b) => b.id);
  const parsed = getState<unknown>(STORE_KEY, null);
  // Runtime guard: TypeScript's <T> on getState is erased; the server could
  // hold any shape (corrupt import, future feature, foreign writer). An
  // unguarded .filter() on a non-array crashes the tile during render.
  if (!Array.isArray(parsed)) return fallback;
  const known = new Set(fallback);
  const valid = parsed.filter((id): id is string => typeof id === 'string' && known.has(id));
  for (const id of fallback) {
    if (!valid.includes(id)) valid.push(id);
  }
  return valid;
}

function BookmarkIcon({ b }: { b: BookmarkDef }) {
  const [stage, setStage] = useState(0);

  const isDashboardIconsSvg = b.src.includes('/dashboard-icons/svg/') && b.src.endsWith('.svg');

  let current = b.src;
  if (stage === 1 && isDashboardIconsSvg) {
    current = b.src
      .replace('/dashboard-icons/svg/', '/dashboard-icons/png/')
      .replace(/\.svg$/, '.png');
  } else if (stage >= 1) {
    return (
      <span className="bm-fallback" aria-hidden="true">
        {b.label.charAt(0).toUpperCase()}
      </span>
    );
  }
  if (stage >= 2) {
    return (
      <span className="bm-fallback" aria-hidden="true">
        {b.label.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      key={stage}
      className="bm-img"
      src={current}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setStage((s) => s + 1)}
    />
  );
}

export function BookmarksTile({ span = 12, onExpand, expandable }: Props) {
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Skip the initial mount: order was just read via loadOrder(), so writing
  // it back is redundant and triggers a debounced PUT on every navigation
  // that re-mounts this tile. Subsequent drag-reorders flow through normally.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setState<string[]>(STORE_KEY, order);
  }, [order]);

  // Cross-tab updates: another tab's drag-reorder broadcasts via the store's
  // BroadcastChannel. Without this we'd hold a stale `order` and overwrite
  // the other tab's edit on our next change.
  useEffect(() => {
    return subscribeState(STORE_KEY, () => {
      const next = loadOrder();
      setOrder((prev) => {
        if (prev.length === next.length && prev.every((id, i) => id === next[i])) return prev;
        return next;
      });
    });
  }, []);

  const lookup = (id: string) => BOOKMARKS.find((b) => b.id === id);

  const onDragStart = (e: DragEvent<HTMLAnchorElement>, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {
      /* noop */
    }
  };

  const onDragOver = (e: DragEvent<HTMLAnchorElement>, id: string) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overId !== id) setOverId(id);
  };

  const onDrop = (e: DragEvent<HTMLAnchorElement>, targetId: string) => {
    e.preventDefault();
    const from = draggingId;
    setDraggingId(null);
    setOverId(null);
    if (!from || from === targetId) return;
    setOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(from);
      const toIdx = next.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      return next;
    });
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setOverId(null);
  };

  return (
    <Tile
      id="bookmarks"
      title="Apps"
      sub={`${BOOKMARKS.length} · drag to reorder`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
    >
      <div className="bm-grid" onDragEnd={onDragEnd}>
        {order.map((id) => {
          const b = lookup(id);
          if (!b) return null;
          const cls = [
            'bm-app',
            draggingId === b.id ? 'is-dragging' : '',
            overId === b.id && draggingId && draggingId !== b.id ? 'is-over' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <a
              key={b.id}
              href={b.url}
              target="_blank"
              rel="noreferrer noopener"
              className={cls}
              draggable
              onDragStart={(e) => onDragStart(e, b.id)}
              onDragOver={(e) => onDragOver(e, b.id)}
              onDrop={(e) => onDrop(e, b.id)}
              onDragLeave={() => setOverId((p) => (p === b.id ? null : p))}
              title={b.url}
            >
              <span className="bm-icon">
                <BookmarkIcon b={b} />
              </span>
              <span className="bm-label">{b.label}</span>
            </a>
          );
        })}
      </div>
    </Tile>
  );
}
