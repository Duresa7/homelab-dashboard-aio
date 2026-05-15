import type { AlertEntry } from '../../types';

interface Props {
  alerts: AlertEntry[];
  onDismiss: (i: number) => void;
}

export function AlertBanner({ alerts, onDismiss }: Props) {
  if (!alerts.length) return null;
  return (
    <div className="alerts">
      {alerts.map((a, i) => (
        <div key={i} className={`alert ${a.kind}`}>
          <span
            className="dot"
            style={{
              background:
                a.kind === 'bad' ? 'var(--bad)' : a.kind === 'warn' ? 'var(--warn)' : 'var(--info)',
            }}
          />
          <div className="body">
            <b>{a.title}</b>
            <span>{a.body}</span>
          </div>
          <span className="ago">{a.ago} ago</span>
          <button className="x" onClick={() => onDismiss(i)} title="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
