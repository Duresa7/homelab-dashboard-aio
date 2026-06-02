import type { DashboardState } from '../../../types';

export function ExpandedEvents({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">All events ({data.events.length})</div>
        <div className="events" style={{ maxHeight: 'none' }}>
          {data.events.map((e, i) => (
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
      </div>
    </div>
  );
}
