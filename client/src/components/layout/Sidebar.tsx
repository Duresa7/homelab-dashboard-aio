import { useEffect, useState, type ReactElement } from 'react';
import { ChevronDown, PanelLeft } from 'lucide-react';
import { NAV_GROUPS } from './nav';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SUBS, SECTION_LABEL, type Route, type Section } from '../../lib/route';
import { getState, setState } from '../../lib/store';
import type { AlertEntry } from '../../types';

interface Props {
  route: Route;
  setRoute: (section: Section, sub?: string) => void;
  alerts: AlertEntry[];
}

const COLLAPSED_KEY = 'sidebarCollapsed';
const EXPANDED_KEY = 'sidebarExpanded';
const DEFAULT_EXPANDED: Section[] = ['proxmox', 'network', 'docker', 'nas', 'cameras'];

function loadCollapsed(): boolean {
  return getState<boolean>(COLLAPSED_KEY, false);
}
function loadExpandedSet(): Set<Section> {
  const arr = getState<Section[] | null>(EXPANDED_KEY, null);
  return new Set(arr ?? DEFAULT_EXPANDED);
}

function WithTip({ show, label, children }: { show: boolean; label: string; children: ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ route, setRoute, alerts }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => loadCollapsed());
  const [expanded, setExpanded] = useState<Set<Section>>(() => loadExpandedSet());

  useEffect(() => {
    document.documentElement.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded');
    setState<boolean>(COLLAPSED_KEY, collapsed);
  }, [collapsed]);

  useEffect(() => {
    setState<Section[]>(EXPANDED_KEY, [...expanded]);
  }, [expanded]);

  const toggleExpanded = (s: Section) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const alertKind = alerts.some((a) => a.kind === 'bad') ? 'bad' : alerts.length ? 'warn' : null;

  const itemClasses = (active: boolean) =>
    cn(
      'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
      collapsed && 'justify-center px-0',
      active
        ? 'bg-[var(--accent-soft)] font-medium text-primary'
        : 'text-[var(--ink-3)] hover:bg-accent hover:text-foreground',
    );

  return (
    <aside className="sticky top-0 flex h-screen w-full flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-card">
      {/* Brand */}
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4', collapsed && 'justify-center px-0')}>
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </svg>
        </div>
        {!collapsed && (
          <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">
            homelab<span className="text-muted-foreground">.local</span>
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label ?? `g${gi}`} className={gi > 0 ? 'mt-4' : ''}>
            {group.label &&
              (collapsed ? (
                <div className="mx-2 my-2 h-px bg-border" />
              ) : (
                <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-4)]">
                  {group.label}
                </div>
              ))}

            {group.items.map((it) => {
              const Icon = it.icon;
              const label = SECTION_LABEL[it.section];
              const isActive = route.section === it.section;
              const subs = it.hasSubs ? SUBS[it.section] ?? [] : [];
              const isOpen = !collapsed && expanded.has(it.section);
              const showBadge = it.section === 'alerts' && alerts.length > 0;

              const badge = showBadge ? (
                <span
                  className={cn(
                    'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    alertKind === 'bad'
                      ? 'bg-[var(--bad)] text-white'
                      : 'bg-[var(--warn)] text-white',
                  )}
                >
                  {alerts.length}
                </span>
              ) : null;

              return (
                <div key={it.section}>
                  <WithTip show={collapsed} label={label}>
                    <button
                      className={itemClasses(isActive)}
                      onClick={() => {
                        if (subs.length) {
                          if (!isActive) {
                            setRoute(it.section);
                            if (!collapsed) setExpanded((prev) => new Set(prev).add(it.section));
                          } else if (!collapsed) {
                            toggleExpanded(it.section);
                          }
                        } else {
                          setRoute(it.section);
                        }
                      }}
                    >
                      <Icon className="size-[18px] shrink-0" strokeWidth={isActive ? 2.25 : 2} />
                      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
                      {!collapsed && badge}
                      {!collapsed && subs.length > 0 && (
                        <ChevronDown
                          className={cn('size-3.5 shrink-0 text-[var(--ink-4)] transition-transform', isOpen && 'rotate-180')}
                        />
                      )}
                    </button>
                  </WithTip>

                  {isOpen && subs.length > 0 && (
                    <div className="mb-1 ml-[26px] mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2.5">
                      {subs.map((s) => {
                        const subActive = isActive && route.sub === s.id;
                        return (
                          <button
                            key={s.id}
                            className={cn(
                              'rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
                              subActive
                                ? 'font-medium text-primary'
                                : 'text-[var(--ink-3)] hover:bg-accent hover:text-foreground',
                            )}
                            onClick={() => setRoute(it.section, s.id)}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-auto shrink-0 border-t border-border p-2">
        {!collapsed && (
          <div className="flex items-center gap-2 px-2.5 pb-1 text-xs text-muted-foreground">
            <span className="status-dot ok" />
            all systems nominal
          </div>
        )}
        <WithTip show={collapsed} label="Expand sidebar">
          <button
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <PanelLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </WithTip>
      </div>
    </aside>
  );
}
