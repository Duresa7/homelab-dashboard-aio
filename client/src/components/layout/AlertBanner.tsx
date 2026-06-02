import { X } from 'lucide-react';
import type { AlertEntry } from '../../types';

const TONE: Record<string, { bar: string; dot: string; tint: string }> = {
  bad: {
    bar: 'border-l-[var(--bad)]',
    dot: 'bg-[var(--bad)]',
    tint: 'bg-[color-mix(in_oklab,var(--bad)_6%,var(--card))]',
  },
  warn: {
    bar: 'border-l-[var(--warn)]',
    dot: 'bg-[var(--warn)]',
    tint: 'bg-[color-mix(in_oklab,var(--warn)_6%,var(--card))]',
  },
  info: {
    bar: 'border-l-[var(--info)]',
    dot: 'bg-[var(--info)]',
    tint: 'bg-[color-mix(in_oklab,var(--info)_6%,var(--card))]',
  },
};

interface Props {
  alerts: AlertEntry[];
  onDismiss: (i: number) => void;
}

export function AlertBanner({ alerts, onDismiss }: Props) {
  if (!alerts.length) return null;
  return (
    <div className="mb-5 flex flex-col gap-2">
      {alerts.map((a, i) => {
        const tone = TONE[a.kind] ?? TONE.info;
        return (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-lg border border-l-2 border-border ${tone.bar} ${tone.tint} px-3.5 py-2.5 shadow-card`}
          >
            <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <b className="text-sm font-semibold text-foreground">{a.title}</b>
              <span className="truncate text-sm text-muted-foreground">{a.body}</span>
            </div>
            <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--ink-4)]">
              {a.ago} ago
            </span>
            <button
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => onDismiss(i)}
              title="Dismiss"
              aria-label="Dismiss alert"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
