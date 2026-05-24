import { Tile } from '../tile/Tile';
import type { StorageData } from '../../types';
import { convertTemp, fmtTemp, tempSuffix, useTempUnit } from '../../lib/units';
import { formatPowerOnTime } from '../../lib/format';
import { diskTempSeverity, severityColor } from '../../lib/severity';

interface Props {
  data: StorageData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function SmartTile({ data, span, onExpand, expandable }: Props) {
  const ok = data.disks.filter((d) => d.smart === 'ok').length;
  const warn = data.disks.filter((d) => d.smart === 'warn').length;
  const bad = data.disks.filter((d) => d.smart === 'bad').length;
  const { unit } = useTempUnit();
  const avgC = data.disks.length
    ? data.disks.reduce((a, b) => a + b.tempC, 0) / data.disks.length
    : 0;
  const avgTemp = Math.round(convertTemp(avgC, unit));
  const tagLabel = bad ? `${bad} failing` : warn ? `${warn} warning` : 'all healthy';
  const tagKind = bad ? 'bad' : warn ? 'warn' : 'ok';
  return (
    <Tile
      title="Disk Health"
      sub={`${data.disks.length} drives`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: tagLabel, kind: tagKind }}
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
          <div className="t-big" style={{ fontSize: 26, color: bad ? 'var(--bad)' : '' }}>{bad}</div>
          <div className="t-sub">failing</div>
        </div>
        <div>
          <div className="t-big" style={{ fontSize: 26, color: severityColor[diskTempSeverity(avgC)] }}>
            {avgTemp}<small>{tempSuffix(unit)}</small>
          </div>
          <div className="t-sub">avg temp</div>
        </div>
      </div>
      <div className="list">
        {data.disks.slice(0, 5).map((d) => (
          <div key={d.name} className="li">
            <span className={`d ${d.smart === 'bad' ? 'bad' : d.smart === 'warn' ? 'warn' : ''}`} />
            <span className="name">{d.name}</span>
            <span className="meta">{d.model}</span>
            <span className="val">
              <span style={{ color: severityColor[diskTempSeverity(d.tempC)] }}>{fmtTemp(d.tempC, unit)}</span>
              <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>
                · {formatPowerOnTime(d.ageHours)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
