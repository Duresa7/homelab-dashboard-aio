import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { NAV_GROUPS } from './nav';
import { cn } from '@/lib/utils';
import { SUBS, SECTION_LABEL, type Route, type Section } from '../../lib/route';
import type { AlertEntry } from '../../types';

interface Props {
  route: Route;
  setRoute: (section: Section, sub?: string) => void;
  alerts: AlertEntry[];
}

const BrandMark = () => (
  <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  </div>
);

export function AppSidebar({ route, setRoute, alerts }: Props) {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const collapsed = state === 'collapsed' && !isMobile;
  const alertKind = alerts.some((a) => a.kind === 'bad') ? 'bad' : alerts.length ? 'warn' : null;

  const go = (section: Section, sub?: string) => {
    setRoute(section, sub);
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-10 items-center gap-2.5 px-1 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
          <BrandMark />
          <span className="font-display text-[15px] font-semibold tracking-tight text-foreground group-data-[collapsible=icon]:hidden">
            homelab<span className="text-muted-foreground">.local</span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group, gi) => (
          <SidebarGroup key={group.label ?? `g${gi}`}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((it) => {
                  const Icon = it.icon;
                  const label = SECTION_LABEL[it.section];
                  const isActive = route.section === it.section;
                  const subs = it.hasSubs ? SUBS[it.section] ?? [] : [];
                  const showBadge = it.section === 'alerts' && alerts.length > 0;

                  // --- Leaf item (no sub-pages) ---
                  if (subs.length === 0) {
                    return (
                      <SidebarMenuItem key={it.section}>
                        <SidebarMenuButton tooltip={label} isActive={isActive} onClick={() => go(it.section)}>
                          <Icon strokeWidth={isActive ? 2.25 : 2} />
                          <span>{label}</span>
                        </SidebarMenuButton>
                        {showBadge && (
                          <>
                            <SidebarMenuBadge className={cn('text-white', alertKind === 'bad' ? 'bg-bad' : 'bg-warn')}>
                              {alerts.length}
                            </SidebarMenuBadge>
                            <span
                              aria-hidden
                              className={cn(
                                'absolute right-1.5 top-1.5 hidden size-2 rounded-full ring-2 ring-sidebar group-data-[collapsible=icon]:block',
                                alertKind === 'bad' ? 'bg-bad' : 'bg-warn',
                              )}
                            />
                          </>
                        )}
                      </SidebarMenuItem>
                    );
                  }

                  // --- Section with sub-pages, sidebar collapsed → hover flyout ---
                  if (collapsed) {
                    return (
                      <SidebarMenuItem key={it.section}>
                        <HoverCard openDelay={80} closeDelay={120}>
                          <HoverCardTrigger asChild>
                            <SidebarMenuButton isActive={isActive} onClick={() => go(it.section)}>
                              <Icon strokeWidth={isActive ? 2.25 : 2} />
                              <span>{label}</span>
                            </SidebarMenuButton>
                          </HoverCardTrigger>
                          <HoverCardContent side="right" align="start" sideOffset={12} className="w-52 p-1.5">
                            <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground">{label}</div>
                            <div className="flex flex-col">
                              {subs.map((s) => {
                                const subActive = isActive && route.sub === s.id;
                                return (
                                  <button
                                    key={s.id}
                                    onClick={() => go(it.section, s.id)}
                                    className={cn(
                                      'rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                                      subActive
                                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                    )}
                                  >
                                    {s.label}
                                  </button>
                                );
                              })}
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      </SidebarMenuItem>
                    );
                  }

                  // --- Section with sub-pages, sidebar expanded → inline subs for active section ---
                  return (
                    <SidebarMenuItem key={it.section}>
                      <SidebarMenuButton isActive={isActive} onClick={() => go(it.section)}>
                        <Icon strokeWidth={isActive ? 2.25 : 2} />
                        <span>{label}</span>
                      </SidebarMenuButton>
                      {isActive && (
                        <SidebarMenuSub>
                          {subs.map((s) => {
                            const subActive = route.sub === s.id;
                            return (
                              <SidebarMenuSubItem key={s.id}>
                                <SidebarMenuSubButton asChild isActive={subActive}>
                                  <button type="button" onClick={() => go(it.section, s.id)}>
                                    <span>{s.label}</span>
                                  </button>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <span className="status-dot ok" />
          all systems nominal
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
