import { Tile } from '../tile/Tile';
import type { EventEntry } from '../../types';

interface Props {
  data: EventEntry[];
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function EventsTile({ data, span, onExpand, expandable }: Props) {
  return (
    <Tile title="Events" sub="recent" span={span} onExpand={onExpand} expandable={expandable}>
      <div className="events">
        {data.map((e, i) => (
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
    </Tile>
  );
}
