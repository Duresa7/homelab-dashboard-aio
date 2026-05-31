import { AlertBanner } from '../components/layout/AlertBanner';
import { StatusBadge } from '@/components/common';
import type { AlertEntry } from '../types';

interface Props {
  alerts: AlertEntry[];
  onDismiss: (i: number) => void;
}

export function AlertsPage({ alerts, onDismiss }: Props) {
  const kind = alerts.length === 0 ? 'ok' : alerts.some((a) => a.kind === 'bad') ? 'bad' : 'warn';
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-foreground">Active alerts</h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{alerts.length}</span>
        </div>
        <StatusBadge kind={kind}>
          {alerts.length === 0 ? 'all clear' : `${alerts.length} active`}
        </StatusBadge>
      </div>
      {alerts.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Everything is healthy.</div>
      ) : (
        <AlertBanner alerts={alerts} onDismiss={onDismiss} />
      )}
    </div>
  );
}
