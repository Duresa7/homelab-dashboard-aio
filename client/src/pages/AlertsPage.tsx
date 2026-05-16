import { AlertBanner } from '../components/layout/AlertBanner';
import type { AlertEntry } from '../types';

interface Props {
  alerts: AlertEntry[];
  onDismiss: (i: number) => void;
}

export function AlertsPage({ alerts, onDismiss }: Props) {
  return (
    <div className="grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">
            Active alerts <span className="t-sub">· {alerts.length}</span>
          </div>
          <span className={`pill ${alerts.length === 0 ? 'ok' : alerts.some((a) => a.kind === 'bad') ? 'bad' : 'warn'}`}>
            <span className="dot" />
            {alerts.length === 0 ? 'all clear' : `${alerts.length} active`}
          </span>
        </div>
        {alerts.length === 0 ? (
          <div className="page-empty">Everything is healthy.</div>
        ) : (
          <AlertBanner alerts={alerts} onDismiss={onDismiss} />
        )}
      </div>
    </div>
  );
}
