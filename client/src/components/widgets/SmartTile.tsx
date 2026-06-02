import { Tile } from '../tile/Tile';
import type { StorageData } from '../../types';
import { convertTemp, tempSuffix, useTempUnit } from '../../lib/units';

interface Props {
  data: StorageData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function SmartTile({ data, span, onExpand, expandable }: Props) {
  const total = data.disks.length;
  const warn = data.disks.filter((d) => d.smart === 'warn').length;
  const bad = data.disks.filter((d) => d.smart === 'bad').length;
  const healthy = total - warn - bad;
  const { unit } = useTempUnit();
  const avgC = total ? data.disks.reduce((a, b) => a + b.tempC, 0) / total : 0;
  const avgTemp = Math.round(convertTemp(avgC, unit));
  const tagLabel = bad ? `${bad} failing` : warn ? `${warn} warning` : 'all healthy';
  const tagKind = bad ? 'bad' : warn ? 'warn' : 'ok';
  return (
    <Tile
      title="Disk Health"
      sub={`${total} drives`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: tagLabel, kind: tagKind }}
    >
      <div className="t-big">
        {healthy}
        <small> / {total}</small>
      </div>
      <div className="t-sub">
        healthy · avg {avgTemp}
        {tempSuffix(unit)}
      </div>
    </Tile>
  );
}
