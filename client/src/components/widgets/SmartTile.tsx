import { Tile } from '../tile/Tile';
import type { StorageData } from '../../types';
import { convertTemp, fmtTemp, tempSuffix, useTempUnit } from '../../lib/units';

interface Props {
  data: StorageData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function SmartTile({ data, span, onExpand, expandable }: Props) {
  const ok = data.disks.filter((d) => d.smart === 'ok').length;
  const warn = data.disks.filter((d) => d.smart === 'warn').length;
  const { unit } = useTempUnit();
  const avgC = data.disks.length
    ? data.disks.reduce((a, b) => a + b.tempC, 0) / data.disks.length
    : 0;
  const avgTemp = Math.round(convertTemp(avgC, unit));
  return (
    <Tile
      title="Disk Health"
      sub={`${data.disks.length} drives`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: warn ? `${warn} warning` : 'all healthy', kind: warn ? 'warn' : 'ok' }}
    >
      <div className="row" style={{ gap: 14 }}>
        <div>
          <div className="t-big" style={{ fontSize: 26 }}>{ok}</div>
          <div className="t-sub">healthy</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 26, color: warn ? 'var(--warn)' : '' }}>{warn}</div>
          <div className="t-sub">warning</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 26 }}>
            {avgTemp}<small>{tempSuffix(unit)}</small>
          </div>
          <div className="t-sub">avg temp</div>
        </div>
      </div>
      <div className="list">
        {data.disks.slice(0, 5).map((d) => (
          <div key={d.name} className="li">
            <span className={`d ${d.smart === 'warn' ? 'warn' : ''}`} />
            <span className="name">{d.name}</span>
            <span className="meta">{d.model}</span>
            <span className="val">{fmtTemp(d.tempC, unit)} · {d.wear}%w</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
