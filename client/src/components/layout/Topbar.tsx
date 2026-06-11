import { Fragment } from 'react';
import { LogOut, RefreshCw, Search, Settings2 } from 'lucide-react';
import { Clock } from './Clock';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { logout, useAuth } from '@/lib/auth';
import type { DateTimePreferences } from '../../lib/datetime';
import { SECTION_LABEL, subLabel, type Section } from '../../lib/route';
import { SECTION_CAPABILITY, usePresentation } from '@/lib/presentation';

interface Props {
  section: Section;
  activeSub?: string;

  entityLabel?: string | null;
  dateTime: DateTimePreferences;

  showSidebarTrigger?: boolean;
  onNavigateSection: (section: Section) => void;
  onOpenSearch: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function UserMenu({ onNavigateSection }: { onNavigateSection: (section: Section) => void }) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user.displayName}`}
          className="grid size-8 place-items-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {initials(user.displayName || user.username)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="truncate text-sm font-medium text-foreground">{user.displayName}</span>
            <span className="truncate font-mono text-xs font-normal text-muted-foreground">
              {user.username} · {user.role}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onNavigateSection('settings')}>
          <Settings2 className="size-4" />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Topbar({
  section,
  activeSub,
  entityLabel,
  dateTime,
  showSidebarTrigger = true,
  onNavigateSection,
  onOpenSearch,
}: Props) {
  const presentation = usePresentation();
  const capabilityId = SECTION_CAPABILITY[section];
  const sectionLbl = capabilityId ? presentation[capabilityId].label : SECTION_LABEL[section];
  const here = activeSub ? subLabel(section, activeSub) : null;

  const trail: string[] = [
    sectionLbl,
    ...(entityLabel ? [entityLabel] : []),
    ...(here ? [here] : []),
  ];
  const lastIndex = trail.length - 1;

  return (
    <header className="sticky top-0 z-30 h-14 shrink-0 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-full w-full max-w-[var(--content-max)] items-center justify-between gap-4 px-[var(--page-pad)]">
        <div className="flex min-w-0 items-center gap-1.5">
          {showSidebarTrigger ? (
            <>
              <SidebarTrigger className="-ml-1.5 size-8 text-muted-foreground hover:text-foreground" />
              <Separator orientation="vertical" className="mr-1 !h-5" />
            </>
          ) : null}
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap sm:gap-1.5">
              {trail.map((label, i) => (
                <Fragment key={i}>
                  {i > 0 ? <BreadcrumbSeparator /> : null}
                  <BreadcrumbItem>
                    {i === lastIndex ? (
                      <BreadcrumbPage className="truncate text-[15px] font-semibold tracking-tight">
                        {label}
                      </BreadcrumbPage>
                    ) : i === 0 ? (
                      <BreadcrumbLink asChild>
                        <button
                          type="button"
                          onClick={() => onNavigateSection(section)}
                          className="truncate"
                        >
                          {label}
                        </button>
                      </BreadcrumbLink>
                    ) : (
                      <span className="truncate text-muted-foreground">{label}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenSearch}
            className="hidden h-8 items-center gap-2 rounded-md border border-border bg-card pl-2.5 pr-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
          >
            <Search className="size-4" />
            <span className="pr-6">Search…</span>
            <kbd className="pointer-events-none rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>

          <div className="mx-1 hidden lg:block">
            <Clock preferences={dateTime} />
          </div>

          <IconAction label="Refresh" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" />
          </IconAction>

          <UserMenu onNavigateSection={onNavigateSection} />
        </div>
      </div>
    </header>
  );
}
