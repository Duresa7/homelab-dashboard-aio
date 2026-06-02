import { RefreshCw, Search } from 'lucide-react';
import { Clock } from './Clock';
import { Button } from '@/components/ui/button';
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
import type { DateTimePreferences } from '../../lib/datetime';
import { SECTION_LABEL, subLabel, type Section } from '../../lib/route';

interface Props {
  section: Section;
  activeSub?: string;
  dateTime: DateTimePreferences;
  onNavigateSection: (section: Section) => void;
  onOpenSearch: () => void;
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
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Topbar({ section, activeSub, dateTime, onNavigateSection, onOpenSearch }: Props) {
  const sectionLbl = SECTION_LABEL[section];
  const here = activeSub ? subLabel(section, activeSub) : null;

  return (
    <header className="sticky top-0 z-30 h-14 shrink-0 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-full w-full max-w-[var(--content-max)] items-center justify-between gap-4 px-[var(--page-pad)]">
        <div className="flex min-w-0 items-center gap-1.5">
          <SidebarTrigger className="-ml-1.5 size-8 text-muted-foreground hover:text-foreground" />
          <Separator orientation="vertical" className="mr-1 !h-5" />
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap sm:gap-1.5">
              {here ? (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <button type="button" onClick={() => onNavigateSection(section)} className="truncate">
                        {sectionLbl}
                      </button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="truncate text-[15px] font-semibold tracking-tight">{here}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : (
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate text-[15px] font-semibold tracking-tight">{sectionLbl}</BreadcrumbPage>
                </BreadcrumbItem>
              )}
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
        </div>
      </div>
    </header>
  );
}
