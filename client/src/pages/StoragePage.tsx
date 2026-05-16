import { SmartTile, StorageTile, UnasTile } from '../components/widgets';
import type { DashboardState } from '../types';
import { fmtTemp, useTempUnit } from '../lib/units';

interface Props {
  data: DashboardState;
  sub: string;
}

function Pools({ data }: { data: DashboardState }) {
  return (
    <div className="grid">
      <StorageTile data={data.storage} span={6} expandable={false} />
      <UnasTile data={data.unas} span={6} expandable={false} />
    </div>
  );
}

function Disks({ data }: { data: DashboardState }) {
  const { unit } = useTempUnit();
  const disks = data.storage.disks;
  return (
    <div className="grid">
      <SmartTile data={data.storage} span={12} expandable={false} />
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">All Disks <span className="t-sub">· {disks.length}</span></div>
        </div>
        {disks.length === 0 ? (
          <div className="page-empty">No disks reported</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>SMART</th>
                <th>Device</th>
                <th>Model</th>
                <th className="num">Temp</th>
                <th className="num">Wear</th>
              </tr>
            </thead>
            <tbody>
              {disks.map((d) => {
                const pillKind = d.smart === 'warn' ? 'warn' : d.smart === 'bad' ? 'bad' : 'ok';
                return (
                  <tr key={d.name}>
                    <td>
                      <span className={`pill ${pillKind}`}>
                        <span className="dot" />
                        {d.smart}
                      </span>
                    </td>
                    <td className="mono">{d.name}</td>
                    <td>{d.model}</td>
                    <td className="mono tnum num">{fmtTemp(d.tempC, unit)}</td>
                    <td className="mono tnum num">{d.wear}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function StoragePage({ data, sub }: Props) {
  if (sub === 'disks') return <Disks data={data} />;
  return <Pools data={data} />;
}
