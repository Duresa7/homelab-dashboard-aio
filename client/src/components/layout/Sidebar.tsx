import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import {
  SUBS,
  SECTION_LABEL,
  type Route,
  type Section,
} from '../../lib/route';
import type { AlertEntry } from '../../types';

interface Props {
  route: Route;
  setRoute: (section: Section, sub?: string) => void;
  alerts: AlertEntry[];
}

interface NavLeaf {
  kind: 'leaf';
  section: Section;
  icon: IconName;
  badge?: string | number;
  badgeKind?: '' | 'warn' | 'bad';
}
interface NavParent {
  kind: 'parent';
  section: Section;
  icon: IconName;
  badge?: string | number;
  badgeKind?: '' | 'warn' | 'bad';
}
interface NavSection { kind: 'section'; label: string }
type NavItem = NavLeaf | NavParent | NavSection;

const COLLAPSED_KEY = 'homelab-dashboard.sidebar-collapsed';
const EXPANDED_KEY  = 'homelab-dashboard.sidebar-expanded';

function loadCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(COLLAPSED_KEY) === '1';
}
function loadExpandedSet(): Set<Section> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set(['proxmox', 'network', 'docker', 'nas', 'cameras'] as Section[]);
    return new Set(JSON.parse(raw) as Section[]);
  } catch {
    return new Set();
  }
}

export function Sidebar({ route, setRoute, alerts }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => loadCollapsed());
  const [expanded, setExpanded] = useState<Set<Section>>(() => loadExpandedSet());

  useEffect(() => {
    document.documentElement.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded');
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch { /* ignore */ }
  }, [collapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch { /* ignore */ }
  }, [expanded]);

  const toggleExpanded = (s: Section) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const items: NavItem[] = [
    { kind: 'leaf', section: 'overview', icon: 'home' },
    { kind: 'section', label: 'systems' },
    { kind: 'parent', section: 'proxmox', icon: 'server', badge: '1 node' },
    { kind: 'parent', section: 'network', icon: 'network' },
    { kind: 'parent', section: 'docker',  icon: 'box',     badge: '20' },
    { kind: 'parent', section: 'nas', icon: 'disk' },
    { kind: 'parent', section: 'cameras', icon: 'camera' },
    { kind: 'section', label: 'observability' },
    { kind: 'leaf', section: 'events', icon: 'activity' },
    {
      kind: 'leaf',
      section: 'alerts',
      icon: 'bell',
      badge: alerts.length || undefined,
      badgeKind: alerts.some((a) => a.kind === 'bad') ? 'bad' : alerts.length ? 'warn' : '',
    },
    { kind: 'leaf', section: 'health', icon: 'activity' },
    { kind: 'leaf', section: 'siem', icon: 'history' },
    { kind: 'section', label: 'preferences' },
    { kind: 'leaf', section: 'settings', icon: 'settings' },
  ];

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
            strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div className="sb-brand-name">homelab<span>.local</span></div>
      </div>

      <nav className="sb-nav">
        {items.map((it, i) => {
          if (it.kind === 'section') {
            return <div key={`s${i}`} className="sb-section">{it.label}</div>;
          }
          const isActiveSection = route.section === it.section;
          const subs = it.kind === 'parent' ? SUBS[it.section] ?? [] : [];
          const isOpen = !collapsed && expanded.has(it.section);
          const tip = SECTION_LABEL[it.section];

          if (it.kind === 'leaf') {
            return (
              <button
                key={it.section}
                className={`sb-link ${isActiveSection ? 'is-active' : ''}`}
                onClick={() => setRoute(it.section)}
                data-tip={tip}
              >
                <Icon name={it.icon} className="ico" />
                <span className="label">{tip}</span>
                {it.badge !== undefined ? (
                  <span className={`badge ${it.badgeKind ?? ''}`}>{it.badge}</span>
                ) : null}
              </button>
            );
          }

          // parent
          return (
            <div key={it.section}>
              <button
                className={`sb-link ${isActiveSection ? 'is-current' : ''}`}
                onClick={() => {
                  if (!isActiveSection) setRoute(it.section);
                  if (!collapsed) {
                    if (!isActiveSection) {
                      // navigating in: ensure parent is open
                      setExpanded((prev) => new Set(prev).add(it.section));
                    } else {
                      // already active: toggle
                      toggleExpanded(it.section);
                    }
                  }
                }}
                data-open={isOpen ? 'true' : 'false'}
                data-tip={tip}
              >
                <Icon name={it.icon} className="ico" />
                <span className="label">{tip}</span>
                {it.badge !== undefined ? (
                  <span className={`badge ${it.badgeKind ?? ''}`}>{it.badge}</span>
                ) : null}
                <Icon name="chevron_right" className="caret" />
              </button>
              {isOpen && subs.length > 0 ? (
                <div className="sb-sub">
                  {subs.map((s) => {
                    const isActiveSub = isActiveSection && route.sub === s.id;
                    return (
                      <button
                        key={s.id}
                        className={`sb-link ${isActiveSub ? 'is-active' : ''}`}
                        onClick={() => setRoute(it.section, s.id)}
                      >
                        <span className="label">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="sb-foot">
        <span className="status-dot ok" />
        all systems nominal
      </div>

      <button
        className="sb-collapse"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <Icon name="chevron_left" className="ico" />
      </button>
    </aside>
  );
}
