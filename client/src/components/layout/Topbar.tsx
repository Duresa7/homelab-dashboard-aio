import { Fragment } from 'react';
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
import { SECTION_CAPABILITY, usePresentation } from '@/lib/presentation';

interface Props {
  section: Section;
  activeSub?: string;
  /** Drilled-in Data Center entity name (node/guest/storage), shown between the
   *  section and the active sub. */
  entityLabel?: string | null;
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
  onNavigateSection,
  onOpenSearch,
}: Props) {
  const presentation = usePresentation();
  const capabilityId = SECTION_CAPABILITY[section];
  const sectionLbl = capabilityId ? presentation[capabilityId].label : SECTION_LABEL[section];
  const here = activeSub ? subLabel(section, activeSub) : null;

  // Ordered breadcrumb trail: section root, optional drilled-in entity, active
  // sub. The last crumb is the current page; earlier ones link back.
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
          <SidebarTrigger className="-ml-1.5 size-8 text-muted-foreground hover:text-foreground" />
          <Separator orientation="vertical" className="mr-1 !h-5" />
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
        </div>
      </div>
    </header>
  );
}
