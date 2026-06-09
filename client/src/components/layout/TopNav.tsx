import { NAV_GROUPS } from './nav';
import { cn } from '@/lib/utils';
import { SECTION_LABEL, type Route, type Section } from '../../lib/route';
import {
  isSectionVisible,
  PresentationIcon,
  SECTION_CAPABILITY,
  usePresentation,
} from '@/lib/presentation';
import type { AlertEntry } from '../../types';

interface Props {
  route: Route;
  setRoute: (section: Section, sub?: string) => void;
  alerts: AlertEntry[];
}

/**
 * Horizontal primary navigation — the "traditional top bar" alternative to the
 * sidebar (Settings → Preferences → Navigation). Same NAV_GROUPS source as the
 * sidebar; sub-pages stay reachable through each page's own tabs.
 */
export function TopNav({ route, setRoute, alerts }: Props) {
  const presentation = usePresentation();
  const alertKind = alerts.some((a) => a.kind === 'bad') ? 'bad' : alerts.length ? 'warn' : null;
  const items = NAV_GROUPS.flatMap((group) => group.items).filter((it) =>
    isSectionVisible(it.section, presentation),
  );

  return (
    <nav
      aria-label="Primary"
      className="sticky top-14 z-20 border-b border-border bg-background/80 backdrop-blur-md"
    >
      <div className="flex w-full max-w-[var(--content-max)] items-center gap-1 overflow-x-auto px-[var(--page-pad)] py-1.5">
        {items.map((it) => {
          const Icon = it.icon;
          const capabilityId = SECTION_CAPABILITY[it.section];
          const capability = capabilityId ? presentation[capabilityId] : null;
          const label = capability?.label ?? SECTION_LABEL[it.section];
          const isActive = route.section === it.section;
          const showBadge = it.section === 'observability' && alerts.length > 0;
          return (
            <button
              key={it.section}
              type="button"
              onClick={() => setRoute(it.section)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {capability ? (
                <PresentationIcon
                  capability={capability.id}
                  icon={capability.icon}
                  label={label}
                  size={15}
                />
              ) : (
                <Icon className="size-[15px]" strokeWidth={isActive ? 2.25 : 2} />
              )}
              <span>{label}</span>
              {showBadge && (
                <span
                  className={cn(
                    'grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-white',
                    alertKind === 'bad' ? 'bg-bad' : 'bg-warn',
                  )}
                >
                  {alerts.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
