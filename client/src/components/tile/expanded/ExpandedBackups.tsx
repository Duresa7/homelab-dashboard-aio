import type { DashboardState } from '../../../types';

export function ExpandedBackups({ data }: { data: DashboardState }) {
  return (
    <div className="ov-grid">
      <div className="tile span-12">
        <div className="t-title">All jobs</div>
        <div className="list">
          {data.backups.map((b) => (
            <div key={b.name} className="li">
              <span
                className={`d ${b.status === 'warn' ? 'warn' : b.status === 'bad' ? 'bad' : ''}`}
              />
              <span className="name">{b.name}</span>
              <span className="meta">{b.when}</span>
              <span className="val">{b.sizeGB} GB</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
