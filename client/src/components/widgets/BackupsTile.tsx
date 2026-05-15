import { Tile } from '../tile/Tile';
import type { Backup } from '../../types';

interface Props {
  data: Backup[];
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function BackupsTile({ data, span, onExpand, expandable }: Props) {
  return (
    <Tile title="Backups" sub={`${data.length} jobs`} span={span} onExpand={onExpand} expandable={expandable}>
      <div className="list">
        {data.map((b) => (
          <div key={b.name} className="li">
            <span className={`d ${b.status === 'warn' ? 'warn' : b.status === 'bad' ? 'bad' : ''}`} />
            <span className="name">{b.name}</span>
            <span className="meta">{b.when}</span>
            <span className="val">{b.sizeGB} GB</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
