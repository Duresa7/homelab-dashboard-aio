import { AlertBanner } from '../components/layout/AlertBanner';
import type { AlertEntry } from '../types';

interface Props {
  alerts: AlertEntry[];
  onDismiss: (i: number) => void;
}

export function AlertsPage({ alerts, onDismiss }: Props) {
  return (
    <div className="col" style={{ gap: 12 }}>
      {alerts.length === 0 ? (
        <div className="tile span-12">
          <div className="t-title">No active alerts</div>
          <div className="t-sub">Everything is healthy.</div>
        </div>
      ) : (
        <AlertBanner alerts={alerts} onDismiss={onDismiss} />
      )}
    </div>
  );
}
