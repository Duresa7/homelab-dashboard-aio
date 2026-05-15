import { Fragment } from 'react';
import { Tile } from '../tile/Tile';
import type { UnasData } from '../../types';
import { fmtTemp, useTempUnit } from '../../lib/units';

interface Props {
  data: UnasData;
  span?: number;
  onExpand?: () => void;
  expandable?: boolean;
}

export function UnasTile({ data, span, onExpand, expandable }: Props) {
  const { unit } = useTempUnit();
  return (
    <Tile
      title="UniFi NAS 2"
      sub={`${fmtTemp(data.tempC, unit)} · ${data.fanRpm} rpm`}
      span={span}
      onExpand={onExpand}
      expandable={expandable}
      tag={{ label: 'healthy', kind: 'ok' }}
    >
      <div className="disks">
        {data.pools.map((p) => {
          const pct = (p.usedTB / p.totalTB) * 100;
          return (
            <div key={p.name} className="disk">
              <div className="row">
                <div className="name flex1">
                  {p.name} <span className="t-tag">{p.type}</span>
                </div>
                <div className="meta">
                  {p.usedTB.toFixed(1)} / {p.totalTB} TB
                </div>
              </div>
              <div className="pbar"><span style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </div>
      <div className="t-sub" style={{ marginTop: 4 }}>Shares</div>
      <dl className="kv">
        {data.shares.map((s) => (
          <Fragment key={s.name}>
            <dt>{s.name}</dt>
            <dd>{s.sizeTB.toFixed(1)} TB</dd>
          </Fragment>
        ))}
      </dl>
    </Tile>
  );
}
