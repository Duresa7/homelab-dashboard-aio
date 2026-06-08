import { useRef, type KeyboardEvent, type ReactNode } from 'react';
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
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = tabs.findIndex((t) => t.id === active);

  // WAI-ARIA tabs keyboard model: Left/Right move between tabs (with wrap),
  // Home/End jump to the ends, and focus follows selection (automatic activation).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const count = tabs.length;
    if (count === 0) return;
    const from = activeIndex < 0 ? 0 : activeIndex;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (from + 1) % count;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (from - 1 + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    btnRefs.current[next]?.focus();
  };

  return (
    <div
      className={cn(
        'col-span-12 flex items-center justify-between gap-4 border-b border-border',
        className,
      )}
    >
      <div
        role="tablist"
        className="flex min-w-0 items-center gap-1 overflow-x-auto"
        onKeyDown={onKeyDown}
      >
        {tabs.map((t, i) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive || (activeIndex < 0 && i === 0) ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                'focus-visible:rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]',
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
