import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SubTab {
  id: string;
  label: ReactNode;
}

export interface SubTabsProps {
  tabs: SubTab[];
  active: string;
  onChange: (id: string) => void;
  /** Optional trailing controls (e.g. a time-window picker), right-aligned. */
  actions?: ReactNode;
  className?: string;
}

/**
 * In-page underline sub-navigation — the reusable page sub-tabs pattern.
 * Linear-style: a thin baseline with an accent underline on the active tab.
 * Replaces ad-hoc button rows; pairs with the section sub-routes.
 */
export function SubTabs({ tabs, active, onChange, actions, className }: SubTabsProps) {
  return (
    <div
      className={cn(
        'col-span-12 flex items-center justify-between gap-4 border-b border-border',
        className,
      )}
    >
      <div role="tablist" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.id)}
              className={cn(
                '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'border-[var(--accent)] text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pb-1">{actions}</div> : null}
    </div>
  );
}
