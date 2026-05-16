import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
}

export function EventsPage({ data }: Props) {
  const events = data.events;
  return (
    <div className="grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">Recent activity <span className="t-sub">· {events.length} entries</span></div>
        </div>
        {events.length === 0 ? (
          <div className="page-empty">No events recorded</div>
        ) : (
          <div className="events" style={{ maxHeight: 'none' }}>
            {events.map((e, i) => (
              <div key={i} className="ev">
                <span className="ts">{e.ts}</span>
                <span className={`d ${e.kind}`} />
                <div className="body">
                  <b>{e.title}</b>
                  <span>{e.body}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
