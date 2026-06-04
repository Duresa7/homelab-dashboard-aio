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

const BOOKMARKS: BookmarkDef[] = [];

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
      sub={BOOKMARKS.length ? `${BOOKMARKS.length} · drag to reorder` : 'No saved apps'}
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
